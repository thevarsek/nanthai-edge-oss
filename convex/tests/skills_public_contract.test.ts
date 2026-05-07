import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import { SYSTEM_SKILL_CATALOG } from "../skills/catalog";
import { seedSystemCatalog } from "../skills/actions";
import {
  createSkill,
  deleteSkill,
  duplicateSystemSkill,
  setChatSkillsPublic,
  setPersonaSkillsPublic,
} from "../skills/mutations";
import {
  getSkillDetail,
  getSkillBySlugForUser,
  listDiscoverableSkills,
  listVisibleSkills,
  listVisibleSkillsInternal,
} from "../skills/queries";
import { getSkillById } from "../skills/queries_internal";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

test("createSkill infers docs profile and rejects duplicate user slug", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];

  const created = await (createSkill as any)._handler({
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => (table === "purchaseEntitlements" ? { _id: "ent_1", status: "active" } : null),
          collect: async () => [],
        }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "skill_new";
      },
    },
  }, {
    name: "DOCX Assistant",
    summary: "Create docs",
    instructionsRaw: "Use generate_docx to create a document.",
    runtimeMode: "toolAugmented",
    requiredToolIds: ["generate_docx"],
  });

  assert.equal(created.skillId, "skill_new");
  assert.ok(Array.isArray(created.validationWarnings));
  assert.equal(inserts[0]?.table, "skills");
  assert.deepEqual(inserts[0]?.value.requiredToolProfiles, ["docs"]);

  await assert.rejects(
    (createSkill as any)._handler({
      auth: buildAuth(),
      db: {
        query: (table: string) => ({
          withIndex: () => ({
            first: async () => (table === "purchaseEntitlements" ? { _id: "ent_1", status: "active" } : null),
            collect: async () => (
              table === "skills"
                ? [{ _id: "skill_existing", ownerUserId: "user_1", slug: "docx-assistant", status: "active" }]
                : []
            ),
          }),
        }),
      },
    }, {
      name: "DOCX Assistant",
      summary: "Duplicate",
      instructionsRaw: "Write docs.",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.code === "DUPLICATE_SLUG";
    },
  );
});

test("deleteSkill removes persona and chat references before deleting", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const deleted: string[] = [];

  await (deleteSkill as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) => (
        id === "skill_1"
          ? { _id: "skill_1", scope: "user", ownerUserId: "user_1" }
          : null
      ),
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => (table === "purchaseEntitlements" ? { _id: "ent_1", status: "active" } : null),
          collect: async () => {
            if (table === "personas") {
              return [{
                _id: "persona_1",
                skillOverrides: [
                  { skillId: "skill_1", state: "available" },
                  { skillId: "skill_2", state: "available" },
                ],
              }];
            }
            if (table === "chats") {
              return [{
                _id: "chat_1",
                skillOverrides: [{ skillId: "skill_1", state: "available" }],
              }];
            }
            return [];
          },
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
  }, { skillId: "skill_1" });

  assert.equal(patches.length, 2);
  assert.deepEqual(
    patches[0]?.value.skillOverrides,
    [{ skillId: "skill_2", state: "available" }]
  );
  assert.deepEqual(patches[1]?.value.skillOverrides, []);
  assert.deepEqual(deleted, ["skill_1"]);
});

test("duplicateSystemSkill increments suffix and public assignment mutations enforce ownership", async () => {
  const inserts: Array<Record<string, unknown>> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];

  const duplicated = await (duplicateSystemSkill as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) => (
        id === "skill_system"
          ? {
              _id: "skill_system",
              scope: "system",
              slug: "docx",
              name: "DOCX",
              summary: "Docs",
              instructionsRaw: "Help",
              compilationStatus: "compiled",
              runtimeMode: "toolAugmented",
              requiredToolIds: ["generate_docx"],
              requiredToolProfiles: ["docs"],
              requiredIntegrationIds: [],
              requiredCapabilities: [],
            }
          : id === "persona_1"
            ? { _id: "persona_1", userId: "user_1" }
            : id === "chat_1"
              ? { _id: "chat_1", userId: "user_1" }
              : null
      ),
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => (table === "purchaseEntitlements" ? { _id: "ent_1", status: "active" } : null),
          collect: async () => (
            table === "skills"
              ? [{ _id: "skill_custom", slug: "docx-custom", status: "active", ownerUserId: "user_1" }]
              : []
          ),
        }),
      }),
      insert: async (_table: string, value: Record<string, unknown>) => {
        inserts.push(value);
        return "skill_custom_2";
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  }, { skillId: "skill_system" });

  assert.equal(duplicated, "skill_custom_2");
  assert.equal(inserts[0]?.slug, "docx-custom-2");

  await (setPersonaSkillsPublic as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "persona_1", userId: "user_1" }),
      query: () => ({
        withIndex: () => ({
          first: async () => ({ _id: "ent_1", status: "active" }),
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  }, { personaId: "persona_1", discoverableSkillIds: ["skill_custom_2"] });

  await (setChatSkillsPublic as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "chat_1", userId: "user_1" }),
      query: () => ({
        withIndex: () => ({
          first: async () => ({ _id: "ent_1", status: "active" }),
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  }, { chatId: "chat_1", discoverableSkillIds: ["skill_system"] });

  assert.equal(patches[0]?.id, "persona_1");
  assert.deepEqual(patches[0]?.value.skillOverrides, [
    { skillId: "skill_custom_2", state: "available" },
  ]);
  assert.equal(patches[1]?.id, "chat_1");
  assert.deepEqual(patches[1]?.value.skillOverrides, [
    { skillId: "skill_system", state: "available" },
  ]);
});

test("skill visibility queries filter capability-gated public skills but not internal lists", async () => {
  const systemSkills = [
    { _id: "skill_visible", scope: "system", visibility: "visible", status: "active", requiredCapabilities: [] },
    { _id: "skill_sandbox", scope: "system", visibility: "visible", status: "active", requiredCapabilities: ["mcpRuntime"] },
  ];
  const userSkills = [
    { _id: "skill_user", scope: "user", ownerUserId: "user_1", visibility: "visible", status: "active", requiredCapabilities: [] },
  ];

  const query = (table: string) => ({
    withIndex: (_index: string) => ({
      collect: async () => {
        if (table === "skills") {
          return _index === "by_scope" ? systemSkills : userSkills;
        }
        if (table === "userCapabilities") {
          return [];
        }
        return [];
      },
      first: async () => null,
    }),
  });

  const publicVisible = await (listVisibleSkills as any)._handler({
    auth: buildAuth(),
    db: { query },
  }, {});
  const discoverable = await (listDiscoverableSkills as any)._handler({
    auth: buildAuth(),
    db: { query },
  }, {});
  const internalVisible = await (listVisibleSkillsInternal as any)._handler({
    db: { query },
  }, { userId: "user_1" });

  assert.deepEqual(publicVisible.map((skill: any) => skill._id), ["skill_visible", "skill_user"]);
  assert.deepEqual(discoverable.map((skill: any) => skill._id), ["skill_visible", "skill_user"]);
  assert.deepEqual(internalVisible.map((skill: any) => skill._id), ["skill_visible", "skill_sandbox", "skill_user"]);
});

test("skill detail and internal lookup helpers are scoped correctly", async () => {
  const systemSkill = { _id: "skill_system", scope: "system", status: "active" };
  const userSkill = { _id: "skill_user", scope: "user", ownerUserId: "user_1", status: "active" };
  const foreignSkill = { _id: "skill_foreign", scope: "user", ownerUserId: "user_2", status: "active" };

  const detailSystem = await (getSkillDetail as any)._handler({
    auth: buildAuth(),
    db: { get: async () => systemSkill },
  }, { skillId: "skill_system" });
  const detailForeign = await (getSkillDetail as any)._handler({
    auth: buildAuth(),
    db: { get: async () => foreignSkill },
  }, { skillId: "skill_foreign" });

  const bySlug = await (getSkillBySlugForUser as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          collect: async () => [systemSkill, userSkill],
        }),
      }),
    },
  }, { slug: "skill", userId: "user_1" });

  const byId = await (getSkillById as any)._handler({
    db: { get: async () => userSkill },
  }, { skillId: "skill_user" });

  assert.equal(detailSystem, systemSkill);
  assert.equal(detailForeign, null);
  assert.equal(bySlug, userSkill);
  assert.equal(byId, userSkill);
});

test("seedSystemCatalog upserts every system skill", async () => {
  const seeded: string[] = [];
  const deleted: string[] = [];

  await (seedSystemCatalog as any)._handler({
    runMutation: async (_ref: unknown, args: { slug?: string; slugs?: string[] }) => {
      if (args.slug) seeded.push(args.slug);
      if (args.slugs) deleted.push(...args.slugs);
    },
  }, {});

  assert.equal(seeded.length, SYSTEM_SKILL_CATALOG.length);
  assert.equal(seeded[0], SYSTEM_SKILL_CATALOG[0]?.slug);
  assert.ok(deleted.includes("release-notes"));
  assert.ok(deleted.includes("solo-founder-gtm"));
});
