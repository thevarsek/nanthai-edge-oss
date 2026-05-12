import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";

import {
  archiveSkillInternal,
  createSkillInternal,
  deleteSkillInternal,
  duplicateSystemSkillInternal,
  setChatSkills,
  setPersonaSkills,
  updateSkillInternal,
} from "../skills/mutations";

function skillQuery(options: {
  bySlug?: unknown[];
  byOwner?: unknown[];
  first?: unknown;
  collect?: unknown[];
} = {}) {
  return {
    withIndex: (index: string, apply?: (q: any) => unknown) => {
      apply?.({ eq: () => ({ eq: () => ({}) }) });
      return {
        first: async () => options.first ?? null,
        collect: async () => {
          if (index === "by_slug") return options.bySlug ?? [];
          if (index === "by_owner") return options.byOwner ?? [];
          return options.collect ?? [];
        },
      };
    },
  };
}

test("internal skill creation saves normalized metadata and rejects duplicate user slugs", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      query: () => skillQuery(),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "skill_new";
      },
    },
  } as any;

  const result = await (createSkillInternal as any)._handler(ctx, {
    userId: "user_1",
    name: "  DOCX Writer  ",
    summary: " Writes documents. ",
    instructionsRaw: "Use generate_docx when the user asks for a Word document.",
    runtimeMode: "toolAugmented",
    requiredToolIds: ["generate_docx"],
  });

  assert.equal(result.skillId, "skill_new");
  assert.equal(inserts[0]?.table, "skills");
  assert.equal(inserts[0]?.value.slug, "docx-writer");
  assert.equal(inserts[0]?.value.name, "DOCX Writer");
  assert.deepEqual(inserts[0]?.value.requiredToolProfiles, ["docs"]);
  assert.equal(inserts[0]?.value.version, 1);

  await assert.rejects(
    (createSkillInternal as any)._handler({
      db: {
        query: () => skillQuery({ byOwner: [{ _id: "skill_existing", slug: "docx-writer" }] }),
      },
    }, {
      userId: "user_1",
      name: "DOCX Writer",
      summary: "Duplicate",
      instructionsRaw: "Write documents.",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "DUPLICATE_SLUG",
  );
});

test("internal skill updates reject missing, unauthorized, duplicate, and system-colliding edits", async () => {
  const baseSkill = {
    _id: "skill_1",
    ownerUserId: "user_1",
    slug: "writer",
    name: "Writer",
    instructionsRaw: "Write.",
    runtimeMode: "textOnly",
    requiredToolIds: [],
    requiredToolProfiles: [],
    requiredIntegrationIds: [],
    requiredCapabilities: [],
    lockState: "editable",
    version: 1,
  };

  await assert.rejects(
    (updateSkillInternal as any)._handler({ db: { get: async () => null } }, {
      skillId: "missing",
      userId: "user_1",
      summary: "Nope",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );

  await assert.rejects(
    (updateSkillInternal as any)._handler({ db: { get: async () => ({ ...baseSkill, ownerUserId: "other_user" }) } }, {
      skillId: "skill_1",
      userId: "user_1",
      summary: "Nope",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "UNAUTHORIZED",
  );

  await assert.rejects(
    (updateSkillInternal as any)._handler({
      db: {
        get: async () => baseSkill,
        query: () => skillQuery({ bySlug: [{ _id: "system_skill", scope: "system", status: "active", name: "Docs" }] }),
      },
    }, {
      skillId: "skill_1",
      userId: "user_1",
      name: "Docs",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "SLUG_COLLISION",
  );

  await assert.rejects(
    (updateSkillInternal as any)._handler({
      db: {
        get: async () => baseSkill,
        query: (table: string) => table === "skills"
          ? skillQuery({ byOwner: [{ _id: "skill_2", slug: "better-writer" }] })
          : skillQuery(),
      },
    }, {
      skillId: "skill_1",
      userId: "user_1",
      name: "Better Writer",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "DUPLICATE_SLUG",
  );
});

test("internal archive and delete mutations enforce user ownership before changing references", async () => {
  for (const mutation of [archiveSkillInternal, deleteSkillInternal]) {
    await assert.rejects(
      (mutation as any)._handler({ db: { get: async () => null } }, { skillId: "missing", userId: "user_1" }),
      (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
    );
    await assert.rejects(
      (mutation as any)._handler({ db: { get: async () => ({ _id: "system_skill", scope: "system" }) } }, {
        skillId: "system_skill",
        userId: "user_1",
      }),
      (error: unknown) => error instanceof ConvexError && ["FORBIDDEN", "NOT_AUTHORIZED"].includes(String(error.data?.code)),
    );
    await assert.rejects(
      (mutation as any)._handler({ db: { get: async () => ({ _id: "skill_1", scope: "user", ownerUserId: "other_user" }) } }, {
        skillId: "skill_1",
        userId: "user_1",
      }),
      (error: unknown) => error instanceof ConvexError && ["UNAUTHORIZED", "NOT_AUTHORIZED"].includes(String(error.data?.code)),
    );
  }
});

test("duplicating system skills rejects invalid sources and uses the first non-colliding custom slug", async () => {
  await assert.rejects(
    (duplicateSystemSkillInternal as any)._handler({ db: { get: async () => null } }, {
      skillId: "missing",
      userId: "user_1",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );
  await assert.rejects(
    (duplicateSystemSkillInternal as any)._handler({ db: { get: async () => ({ _id: "skill_1", scope: "user" }) } }, {
      skillId: "skill_1",
      userId: "user_1",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "FORBIDDEN",
  );

  const inserts: Array<Record<string, unknown>> = [];
  const newId = await (duplicateSystemSkillInternal as any)._handler({
    db: {
      get: async () => ({
        _id: "system_skill",
        scope: "system",
        slug: "researcher",
        name: "Researcher",
        summary: "Research",
        instructionsRaw: "Research.",
        compilationStatus: "compiled",
        runtimeMode: "textOnly",
        requiredToolIds: [],
        requiredIntegrationIds: [],
      }),
      query: () => skillQuery({ byOwner: [] }),
      insert: async (_table: string, value: Record<string, unknown>) => {
        inserts.push(value);
        return "skill_copy";
      },
    },
  }, { skillId: "system_skill", userId: "user_1" });

  assert.equal(newId, "skill_copy");
  assert.equal(inserts[0]?.slug, "researcher-custom");
  assert.equal(inserts[0]?.name, "Researcher (Custom)");
});

test("legacy persona and chat skill mutations preserve ownership and merge chat overrides", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "persona_1") return { _id: "persona_1", userId: "user_1" };
        if (id === "chat_1") {
          return {
            _id: "chat_1",
            userId: "user_1",
            skillOverrides: [
              { skillId: "skill_existing", state: "always" },
              { skillId: "skill_disabled", state: "never" },
            ],
          };
        }
        return null;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  } as any;

  await (setPersonaSkills as any)._handler(ctx, {
    personaId: "persona_1",
    userId: "user_1",
    discoverableSkillIds: ["skill_a", "skill_b"],
  });
  await (setChatSkills as any)._handler(ctx, {
    chatId: "chat_1",
    userId: "user_1",
    discoverableSkillIds: ["skill_disabled", "skill_new"],
    disabledSkillIds: ["skill_existing"],
  });

  assert.deepEqual(patches[0]?.patch.skillOverrides, [
    { skillId: "skill_a", state: "available" },
    { skillId: "skill_b", state: "available" },
  ]);
  assert.deepEqual(patches[1]?.patch.skillOverrides, [
    { skillId: "skill_existing", state: "never" },
    { skillId: "skill_disabled", state: "available" },
    { skillId: "skill_new", state: "available" },
  ]);
});
