import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";

import {
  archiveSkill,
  createSkill,
  createSkillInternal,
  deleteSkill,
  deleteSkillInternal,
  duplicateSystemSkill,
  setChatSkills,
  setPersonaSkills,
  updateSkill,
} from "../skills/mutations";

function buildCtx(options?: {
  records?: Record<string, Record<string, unknown>>;
  tableRows?: Record<string, Array<Record<string, unknown>>>;
  userId?: string | null;
}) {
  const records = new Map(Object.entries(options?.records ?? {}));
  const tableRows = new Map(Object.entries(options?.tableRows ?? {}));
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown>; id: string }> = [];
  const deletes: string[] = [];

  const queryRows = (table: string, filters: Array<[string, unknown]>) =>
    (tableRows.get(table) ?? []).filter((row) =>
      filters.every(([field, value]) => row[field] === value),
    );

  const ctx = {
    auth: {
      getUserIdentity: async () =>
        options?.userId === null ? null : { subject: options?.userId ?? "user_1" },
    },
    db: {
      get: async (id: string) => records.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
        records.set(id, { ...(records.get(id) ?? { _id: id }), ...patch });
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = `${table}_${inserts.length + 1}`;
        inserts.push({ table, value, id });
        records.set(id, { _id: id, ...value });
        tableRows.set(table, [...(tableRows.get(table) ?? []), { _id: id, ...value }]);
        return id;
      },
      delete: async (id: string) => {
        deletes.push(id);
        records.delete(id);
      },
      query: (table: string) => {
        const filters: Array<[string, unknown]> = [];
        const chain = {
          withIndex: (_index: string, apply?: (q: any) => unknown) => {
            const q = {
              eq: (field: string, value: unknown) => {
                filters.push([field, value]);
                return q;
              },
            };
            apply?.(q);
            return chain;
          },
          filter: () => chain,
          order: () => chain,
          first: async () => queryRows(table, filters)[0] ?? null,
          collect: async () => queryRows(table, filters),
          take: async (limit: number) => queryRows(table, filters).slice(0, limit),
        };
        return chain;
      },
    },
  } as any;

  return { ctx, records, patches, inserts, deletes, tableRows };
}

test("skill metadata validation rejects unknown tool, profile, integration, and capability requirements", async () => {
  const cases: Array<{
    args: Record<string, unknown>;
    code: string;
  }> = [
    { args: { requiredToolIds: ["not_a_tool"] }, code: "UNKNOWN_TOOL_IDS" },
    { args: { requiredToolProfiles: ["not_a_profile"] }, code: "UNKNOWN_TOOL_PROFILES" },
    { args: { requiredIntegrationIds: ["not_an_integration"] }, code: "UNKNOWN_INTEGRATIONS" },
    { args: { requiredCapabilities: ["not_a_capability"] }, code: "UNKNOWN_CAPABILITIES" },
  ];

  for (const testCase of cases) {
    await assert.rejects(
      (createSkillInternal as any)._handler(buildCtx().ctx, {
        userId: "user_1",
        name: `Validation ${testCase.code}`,
        summary: "Validates metadata",
        instructionsRaw: "Answer using the current conversation context.",
        ...testCase.args,
      }),
      (error: unknown) => error instanceof ConvexError && error.data?.code === testCase.code,
    );
  }
});

test("skill metadata accepts only Remote MCP targets owned by the skill owner", async () => {
  const owned = buildCtx({
    tableRows: {
      mcpConnections: [{
        _id: "mcp_1",
        userId: "user_1",
        integrationId: "mcp:connection-1",
      }],
    },
  });
  await (createSkillInternal as any)._handler(owned.ctx, {
    userId: "user_1",
    name: "Cloudflare Research",
    summary: "Searches documentation",
    instructionsRaw: "Use the connected Cloudflare Remote MCP tools to answer documentation questions.",
    requiredIntegrationIds: ["mcp:connection-1"],
  });
  assert.deepEqual(owned.inserts[0]?.value.requiredIntegrationIds, ["mcp:connection-1"]);

  await assert.rejects(
    (createSkillInternal as any)._handler(buildCtx().ctx, {
      userId: "user_1",
      name: "Foreign MCP",
      summary: "Invalid target",
      instructionsRaw: "Use the selected Remote MCP tools to answer the question.",
      requiredIntegrationIds: ["mcp:someone-elses-connection"],
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "UNKNOWN_INTEGRATIONS",
  );
});

test("public skill creation enforces pro auth, duplicate slugs, and stores normalized user-authored skills", async () => {
  await assert.rejects(
    (createSkill as any)._handler(buildCtx({ userId: null }).ctx, {
      name: "Research Assistant",
      summary: "Research",
      instructionsRaw: "Summarize context.",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "AUTH_REQUIRED",
  );

  await assert.rejects(
    (createSkill as any)._handler(buildCtx({ tableRows: { purchaseEntitlements: [] } }).ctx, {
      name: "Research Assistant",
      summary: "Research",
      instructionsRaw: "Summarize context.",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "PRO_REQUIRED",
  );

  const duplicate = buildCtx({
    tableRows: {
      purchaseEntitlements: [{ _id: "ent_1", userId: "user_1", status: "active" }],
      skills: [{ _id: "skill_existing", ownerUserId: "user_1", status: "active", slug: "research-assistant" }],
    },
  });
  await assert.rejects(
    (createSkill as any)._handler(duplicate.ctx, {
      name: "Research Assistant",
      summary: "Research",
      instructionsRaw: "Summarize context.",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "DUPLICATE_SLUG",
  );

  const created = buildCtx({
    tableRows: {
      purchaseEntitlements: [{ _id: "ent_1", userId: "user_1", status: "active" }],
      skills: [],
    },
  });
  const result = await (createSkill as any)._handler(created.ctx, {
    name: "  Research Assistant  ",
    summary: " Helps with research. ",
    instructionsRaw: "Summarize context and ask clarifying questions when needed.",
    runtimeMode: "toolAugmented",
    requiredToolIds: ["search_chats"],
  });

  assert.equal(result.skillId, "skills_1");
  assert.equal(created.inserts[0]?.value.slug, "research-assistant");
  assert.equal(created.inserts[0]?.value.origin, "userAuthored");
  assert.equal(created.inserts[0]?.value.summary, "Helps with research.");
  assert.deepEqual(created.inserts[0]?.value.requiredToolIds, ["search_chats"]);
});

test("deleting a skill removes user, persona, and chat references without touching unrelated overrides", async () => {
  const state = buildCtx({
    records: {
      skill_1: {
        _id: "skill_1",
        scope: "user",
        ownerUserId: "user_1",
        status: "active",
      },
    },
    tableRows: {
      userPreferences: [{
        _id: "prefs_1",
        userId: "user_1",
        skillDefaults: [
          { skillId: "skill_1", state: "always" },
          { skillId: "skill_other", state: "available" },
        ],
      }],
      personas: [
        {
          _id: "persona_1",
          userId: "user_1",
          skillOverrides: [
            { skillId: "skill_1", state: "never" },
            { skillId: "skill_other", state: "available" },
          ],
        },
        { _id: "persona_2", userId: "user_1", skillOverrides: [{ skillId: "skill_other", state: "always" }] },
      ],
      chats: [
        {
          _id: "chat_1",
          userId: "user_1",
          skillOverrides: [
            { skillId: "skill_1", state: "available" },
            { skillId: "skill_other", state: "never" },
          ],
        },
        { _id: "chat_2", userId: "user_1" },
      ],
    },
  });

  await (deleteSkillInternal as any)._handler(state.ctx, {
    skillId: "skill_1",
    userId: "user_1",
  });

  assert.deepEqual(state.patches.find((entry) => entry.id === "prefs_1")?.patch.skillDefaults, [
    { skillId: "skill_other", state: "available" },
  ]);
  assert.deepEqual(state.patches.find((entry) => entry.id === "persona_1")?.patch.skillOverrides, [
    { skillId: "skill_other", state: "available" },
  ]);
  assert.equal(state.patches.some((entry) => entry.id === "persona_2"), false);
  assert.deepEqual(state.patches.find((entry) => entry.id === "chat_1")?.patch.skillOverrides, [
    { skillId: "skill_other", state: "never" },
  ]);
  assert.deepEqual(state.deletes, ["skill_1"]);
});

test("skill lifecycle and assignment mutations reject missing, foreign, locked, and system rows before patching", async () => {
  const proRows = {
    purchaseEntitlements: [{ _id: "ent_1", userId: "user_1", status: "active" }],
  };
  const rejectionCases = [
    [setPersonaSkills, buildCtx().ctx, { personaId: "missing", userId: "user_1", discoverableSkillIds: [] }, "NOT_FOUND"],
    [setPersonaSkills, buildCtx({ records: { persona_1: { _id: "persona_1", userId: "other_user" } } }).ctx, { personaId: "persona_1", userId: "user_1", discoverableSkillIds: [] }, "UNAUTHORIZED"],
    [setChatSkills, buildCtx().ctx, { chatId: "missing", userId: "user_1" }, "NOT_FOUND"],
    [setChatSkills, buildCtx({ records: { chat_1: { _id: "chat_1", userId: "other_user" } } }).ctx, { chatId: "chat_1", userId: "user_1" }, "UNAUTHORIZED"],
    [updateSkill, buildCtx({ tableRows: proRows }).ctx, { skillId: "missing", summary: "Nope" }, "NOT_FOUND"],
    [updateSkill, buildCtx({ records: { skill_1: { _id: "skill_1", ownerUserId: "other_user", lockState: "editable" } }, tableRows: proRows }).ctx, { skillId: "skill_1", summary: "Nope" }, "NOT_AUTHORIZED"],
    [updateSkill, buildCtx({ records: { skill_1: { _id: "skill_1", ownerUserId: "user_1", lockState: "locked" } }, tableRows: proRows }).ctx, { skillId: "skill_1", summary: "Nope" }, "LOCKED"],
    [archiveSkill, buildCtx({ records: { skill_1: { _id: "skill_1", scope: "system" } }, tableRows: proRows }).ctx, { skillId: "skill_1" }, "NOT_AUTHORIZED"],
    [deleteSkill, buildCtx({ records: { skill_1: { _id: "skill_1", scope: "user", ownerUserId: "other_user" } }, tableRows: proRows }).ctx, { skillId: "skill_1" }, "NOT_AUTHORIZED"],
    [duplicateSystemSkill, buildCtx({ tableRows: proRows }).ctx, { skillId: "missing" }, "NOT_FOUND"],
    [duplicateSystemSkill, buildCtx({ records: { skill_1: { _id: "skill_1", scope: "user" } }, tableRows: proRows }).ctx, { skillId: "skill_1" }, "INVALID_ARGS"],
  ];

  for (const [mutation, ctx, args, code] of rejectionCases) {
    await assert.rejects(
      (mutation as any)._handler(ctx, args),
      (error: unknown) => error instanceof ConvexError && error.data?.code === code,
    );
  }
});
