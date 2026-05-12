import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  archiveSkillInternal,
  createSkillInternal,
  deleteSkillInternal,
  deleteSkill,
  duplicateSystemSkill,
  setChatIntegrationOverrides,
  setChatIntegrationOverridesInternal,
  setChatSkillOverrides,
  setChatSkillOverridesInternal,
  setPersonaIntegrationOverrides,
  setPersonaIntegrationOverridesInternal,
  setPersonaSkillOverrides,
  setPersonaSkillOverridesInternal,
  updateCompilationStatus,
  updateSkill,
  updateSkillInternal,
} from "../skills/mutations";

function auth(userId = "user_1") {
  return { getUserIdentity: async () => ({ subject: userId }) };
}

function queryChain(result: { first?: unknown; collect?: unknown[] }) {
  return {
    withIndex: (_index: string, apply?: (q: any) => unknown) => {
      apply?.({ eq: () => ({ eq: () => ({}) }) });
      return {
        first: async () => result.first ?? null,
        collect: async () => result.collect ?? [],
      };
    },
  };
}

test("internal skill creation rejects incompatible instructions and system slug collisions", async () => {
  await assert.rejects(
    (createSkillInternal as any)._handler({
      db: {
        query: (table: string) => queryChain({
          collect: table === "skills"
            ? [{ _id: "sys_1", slug: "browser", scope: "system", status: "active", name: "Browser" }]
            : [],
        }),
      },
    }, {
      userId: "user_1",
      name: "Browser",
      summary: "Conflict",
      instructionsRaw: "Answer questions.",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "SLUG_COLLISION",
  );

  await assert.rejects(
    (createSkillInternal as any)._handler({
      db: {
        query: () => queryChain({ collect: [] }),
      },
    }, {
      userId: "user_1",
      name: "Local Runner",
      summary: "Runs commands",
      instructionsRaw: "Use Playwright browser automation to capture screenshots.",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "SKILL_INCOMPATIBLE",
  );
});

test("skill metadata validation rejects unknown tools, profiles, integrations, and capabilities", async () => {
  const ctx = {
    db: {
      query: () => queryChain({ collect: [] }),
    },
  } as any;

  await assert.rejects(
    (createSkillInternal as any)._handler(ctx, {
      userId: "user_1",
      name: "Unknown Tool",
      summary: "Invalid",
      instructionsRaw: "Use a tool.",
      requiredToolIds: ["not_a_real_tool"],
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "UNKNOWN_TOOL_IDS",
  );
  await assert.rejects(
    (createSkillInternal as any)._handler(ctx, {
      userId: "user_1",
      name: "Unknown Profile",
      summary: "Invalid",
      instructionsRaw: "Use a profile.",
      requiredToolProfiles: ["not_a_real_profile"],
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "UNKNOWN_TOOL_PROFILES",
  );
  await assert.rejects(
    (createSkillInternal as any)._handler(ctx, {
      userId: "user_1",
      name: "Unknown Integration",
      summary: "Invalid",
      instructionsRaw: "Use an integration.",
      requiredIntegrationIds: ["not_a_real_integration"],
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "UNKNOWN_INTEGRATIONS",
  );
  await assert.rejects(
    (createSkillInternal as any)._handler(ctx, {
      userId: "user_1",
      name: "Unknown Capability",
      summary: "Invalid",
      instructionsRaw: "Use a capability.",
      requiredCapabilities: ["not_a_real_capability"],
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "UNKNOWN_CAPABILITIES",
  );
});

test("skill updates normalize metadata, detect duplicate slugs, and protect locked skills", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const baseSkill = {
    _id: "skill_1",
    ownerUserId: "user_1",
    scope: "user",
    slug: "writer",
    name: "Writer",
    summary: "Writes",
    instructionsRaw: "Draft documents.",
    runtimeMode: "textOnly",
    requiredToolIds: [],
    requiredToolProfiles: [],
    requiredIntegrationIds: [],
    requiredCapabilities: [],
    lockState: "editable",
    version: 3,
  };

  const ctx = {
    auth: auth(),
    db: {
      get: async () => baseSkill,
      query: (table: string) => {
        if (table === "purchaseEntitlements") return queryChain({ first: { _id: "ent_1", status: "active" } });
        if (table === "skills") return queryChain({ collect: [] });
        return queryChain({});
      },
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
    },
  } as any;

  const result = await (updateSkill as any)._handler(ctx, {
    skillId: "skill_1",
    name: "DOCX Writer",
    summary: "Writes docs",
    instructionsRaw: "Use generate_docx when the user asks for a Word document.",
    runtimeMode: "toolAugmented",
    requiredToolIds: ["generate_docx"],
  });

  assert.equal(result.skillId, "skill_1");
  assert.equal(patches[0]?.patch.slug, "docx-writer");
  assert.deepEqual(patches[0]?.patch.requiredToolProfiles, ["docs"]);
  assert.equal(patches[0]?.patch.version, 4);

  await assert.rejects(
    (updateSkillInternal as any)._handler({
      db: {
        get: async () => ({ ...baseSkill, lockState: "locked" }),
      },
    }, { skillId: "skill_1", userId: "user_1", summary: "Nope" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "LOCKED",
  );
});

test("deleting and archiving internal skills enforce ownership and clean all references", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deleted: string[] = [];

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "skill_1") return { _id: "skill_1", scope: "user", ownerUserId: "user_1" };
        return null;
      },
      query: (table: string) => {
        if (table === "userPreferences") {
          return queryChain({ first: { _id: "prefs_1", skillDefaults: [{ skillId: "skill_1", state: "always" }] } });
        }
        if (table === "personas") {
          return queryChain({ collect: [{ _id: "persona_1", skillOverrides: [{ skillId: "skill_1", state: "available" }] }] });
        }
        if (table === "chats") {
          return queryChain({ collect: [{ _id: "chat_1", skillOverrides: [{ skillId: "skill_1", state: "never" }] }] });
        }
        return queryChain({});
      },
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
      delete: async (id: string) => deleted.push(id),
    },
  } as any;

  await (deleteSkillInternal as any)._handler(ctx, { skillId: "skill_1", userId: "user_1" });
  assert.deepEqual(deleted, ["skill_1"]);
  assert.deepEqual(patches.find((entry) => entry.id === "prefs_1")?.patch.skillDefaults, []);
  assert.deepEqual(patches.find((entry) => entry.id === "persona_1")?.patch.skillOverrides, []);
  assert.deepEqual(patches.find((entry) => entry.id === "chat_1")?.patch.skillOverrides, []);

  await (archiveSkillInternal as any)._handler({
    db: {
      get: async () => ({ _id: "skill_2", scope: "user", ownerUserId: "user_1" }),
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
    },
  }, { skillId: "skill_2", userId: "user_1" });
  assert.ok(patches.some((entry) => entry.id === "skill_2" && entry.patch.status === "archived"));
});

test("public skill duplication suffixes colliding slugs and delete rejects system skills", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];

  const ctx = {
    auth: auth(),
    db: {
      get: async (id: string) => {
        if (id === "system_skill") {
          return {
            _id: "system_skill",
            slug: "writer",
            name: "Writer",
            summary: "Writes",
            instructionsRaw: "Draft.",
            instructionsCompiled: "Draft.",
            compilationStatus: "compiled",
            scope: "system",
            runtimeMode: "textOnly",
            requiredToolIds: [],
            requiredToolProfiles: undefined,
            requiredIntegrationIds: [],
            requiredCapabilities: undefined,
            unsupportedCapabilityCodes: [],
            validationWarnings: [],
          };
        }
        if (id === "user_skill") {
          return {
            _id: "user_skill",
            scope: "user",
            ownerUserId: "other_user",
          };
        }
        return null;
      },
      query: (table: string) => {
        if (table === "purchaseEntitlements") return queryChain({ first: { _id: "ent_1", status: "active" } });
        if (table === "skills") {
          return queryChain({
            collect: [
              { _id: "skill_custom_1", slug: "writer-custom" },
              { _id: "skill_custom_2", slug: "writer-custom-2" },
            ],
          });
        }
        return queryChain({});
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "skill_new";
      },
      patch: async () => undefined,
    },
  } as any;

  assert.equal(await (duplicateSystemSkill as any)._handler(ctx, { skillId: "system_skill" }), "skill_new");
  assert.equal(inserts[0]?.value.slug, "writer-custom-3");
  assert.equal(inserts[0]?.value.name, "Writer (Custom 3)");

  await assert.rejects(
    (deleteSkill as any)._handler({
      ...ctx,
      db: {
        ...ctx.db,
        get: async () => ({ _id: "system_skill", scope: "system", ownerUserId: undefined }),
      },
    }, { skillId: "system_skill" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_AUTHORIZED",
  );
  await assert.rejects(
    (deleteSkill as any)._handler(ctx, { skillId: "user_skill" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_AUTHORIZED",
  );
});

test("layered skill and integration override mutations patch owned persona and chat surfaces", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const ctx = {
    auth: auth(),
    db: {
      get: async (id: string) => ({ _id: id, userId: "user_1" }),
      query: (table: string) => queryChain({
        first: table === "purchaseEntitlements" ? { _id: "ent_1", status: "active" } : null,
      }),
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
    },
  } as any;

  await (setPersonaSkillOverrides as any)._handler(ctx, {
    personaId: "persona_1",
    skillOverrides: [{ skillId: "skill_1", state: "always" }],
  });
  await (setPersonaIntegrationOverrides as any)._handler(ctx, {
    personaId: "persona_1",
    integrationOverrides: [{ integrationId: "notion", enabled: true }],
  });
  await (setChatSkillOverrides as any)._handler(ctx, {
    chatId: "chat_1",
    skillOverrides: [{ skillId: "skill_1", state: "never" }],
  });
  await (setChatIntegrationOverrides as any)._handler(ctx, {
    chatId: "chat_1",
    integrationOverrides: [{ integrationId: "gmail", enabled: false }],
  });

  await (setPersonaSkillOverridesInternal as any)._handler(ctx, {
    personaId: "persona_2",
    userId: "user_1",
    skillOverrides: [{ skillId: "skill_2", state: "available" }],
  });
  await (setPersonaIntegrationOverridesInternal as any)._handler(ctx, {
    personaId: "persona_2",
    userId: "user_1",
    integrationOverrides: [{ integrationId: "slack", enabled: true }],
  });
  await (setChatSkillOverridesInternal as any)._handler(ctx, {
    chatId: "chat_2",
    userId: "user_1",
    skillOverrides: [{ skillId: "skill_2", state: "always" }],
  });
  await (setChatIntegrationOverridesInternal as any)._handler(ctx, {
    chatId: "chat_2",
    userId: "user_1",
    integrationOverrides: [{ integrationId: "drive", enabled: true }],
  });

  await (updateCompilationStatus as any)._handler(ctx, {
    skillId: "skill_3",
    compilationStatus: "failed",
    instructionsCompiled: "Compiled",
    runtimeMode: "sandboxAugmented",
    requiredToolIds: ["workspace_exec"],
    requiredToolProfiles: ["workspace"],
    requiredIntegrationIds: ["notion"],
    requiredCapabilities: ["pro"],
  });

  assert.equal(patches.length, 9);
  assert.deepEqual(patches[0]?.patch.skillOverrides, [{ skillId: "skill_1", state: "always" }]);
  assert.deepEqual(patches[3]?.patch.integrationOverrides, [{ integrationId: "gmail", enabled: false }]);
  assert.equal(patches[8]?.patch.compilationStatus, "failed");
});
