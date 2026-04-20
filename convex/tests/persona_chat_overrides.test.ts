import assert from "node:assert/strict";
import test from "node:test";

import {
  setPersonaSkillOverrides,
  setPersonaIntegrationOverrides,
  setChatSkillOverrides,
  setChatIntegrationOverrides,
} from "../skills/mutations";

// =============================================================================
// Helpers
// =============================================================================

function buildAuth(userId = "user_1") {
  return { getUserIdentity: async () => ({ subject: userId, email: "u@test.com" }) };
}

function buildCtx(opts: {
  userId?: string;
  persona?: Record<string, unknown> | null;
  chat?: Record<string, unknown> | null;
  isPro?: boolean;
} = {}) {
  const { userId = "user_1", persona = null, chat = null, isPro = true } = opts;
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  return {
    patches,
    ctx: {
      auth: buildAuth(userId),
      db: {
        get: async (id: string) => {
          if (persona && (persona as any)._id === id) return persona;
          if (chat && (chat as any)._id === id) return chat;
          return null;
        },
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
        },
        query: (table: string) => ({
          withIndex: () => ({
            first: async () => {
              if (table === "purchaseEntitlements" && isPro) {
                return { _id: "ent_1", userId, status: "active" };
              }
              return null;
            },
            filter: () => ({
              first: async () => isPro ? { _id: "ent_1", userId, status: "active" } : null,
            }),
          }),
        }),
      },
    } as any,
  };
}

function makePersona(overrides: Record<string, unknown> = {}) {
  return { _id: "persona_1", userId: "user_1", ...overrides };
}

function makeChat(overrides: Record<string, unknown> = {}) {
  return { _id: "chat_1", userId: "user_1", ...overrides };
}

// =============================================================================
// setPersonaSkillOverrides
// =============================================================================

test("setPersonaSkillOverrides sets skill overrides on persona", async () => {
  const { ctx, patches } = buildCtx({ persona: makePersona() });
  const overrides = [{ skillId: "skill_1" as any, state: "always" as const }];

  await (setPersonaSkillOverrides as any)._handler(ctx, {
    personaId: "persona_1",
    skillOverrides: overrides,
  });

  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].patch.skillOverrides, overrides);
  assert.ok(patches[0].patch.updatedAt);
});

test("setPersonaSkillOverrides rejects missing persona", async () => {
  const { ctx } = buildCtx();
  await assert.rejects(
    (setPersonaSkillOverrides as any)._handler(ctx, {
      personaId: "missing",
      skillOverrides: [],
    }),
    /not found/i,
  );
});

test("setPersonaSkillOverrides rejects wrong owner", async () => {
  const { ctx } = buildCtx({ persona: makePersona({ userId: "other_user" }) });
  await assert.rejects(
    (setPersonaSkillOverrides as any)._handler(ctx, {
      personaId: "persona_1",
      skillOverrides: [],
    }),
    /not authorized/i,
  );
});

test("setPersonaSkillOverrides rejects non-Pro user", async () => {
  const { ctx } = buildCtx({ persona: makePersona(), isPro: false });
  await assert.rejects(
    (setPersonaSkillOverrides as any)._handler(ctx, {
      personaId: "persona_1",
      skillOverrides: [],
    }),
  );
});

// =============================================================================
// setPersonaIntegrationOverrides
// =============================================================================

test("setPersonaIntegrationOverrides sets integration overrides", async () => {
  const { ctx, patches } = buildCtx({ persona: makePersona() });
  const overrides = [{ integrationId: "gmail", enabled: true }];

  await (setPersonaIntegrationOverrides as any)._handler(ctx, {
    personaId: "persona_1",
    integrationOverrides: overrides,
  });

  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].patch.integrationOverrides, overrides);
});

test("setPersonaIntegrationOverrides rejects wrong owner", async () => {
  const { ctx } = buildCtx({ persona: makePersona({ userId: "other" }) });
  await assert.rejects(
    (setPersonaIntegrationOverrides as any)._handler(ctx, {
      personaId: "persona_1",
      integrationOverrides: [],
    }),
    /not authorized/i,
  );
});

// =============================================================================
// setChatSkillOverrides
// =============================================================================

test("setChatSkillOverrides sets skill overrides on chat", async () => {
  const { ctx, patches } = buildCtx({ chat: makeChat() });
  const overrides = [
    { skillId: "skill_1" as any, state: "always" as const },
    { skillId: "skill_2" as any, state: "never" as const },
  ];

  await (setChatSkillOverrides as any)._handler(ctx, {
    chatId: "chat_1",
    skillOverrides: overrides,
  });

  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].patch.skillOverrides, overrides);
});

test("setChatSkillOverrides rejects missing chat", async () => {
  const { ctx } = buildCtx();
  await assert.rejects(
    (setChatSkillOverrides as any)._handler(ctx, {
      chatId: "missing",
      skillOverrides: [],
    }),
    /not found/i,
  );
});

test("setChatSkillOverrides rejects wrong owner", async () => {
  const { ctx } = buildCtx({ chat: makeChat({ userId: "other" }) });
  await assert.rejects(
    (setChatSkillOverrides as any)._handler(ctx, {
      chatId: "chat_1",
      skillOverrides: [],
    }),
    /not authorized/i,
  );
});

// No Pro check for chat overrides (chat is a regular feature)

// =============================================================================
// setChatIntegrationOverrides
// =============================================================================

test("setChatIntegrationOverrides sets integration overrides on chat", async () => {
  const { ctx, patches } = buildCtx({ chat: makeChat() });
  const overrides = [
    { integrationId: "gmail", enabled: true },
    { integrationId: "notion", enabled: false },
  ];

  await (setChatIntegrationOverrides as any)._handler(ctx, {
    chatId: "chat_1",
    integrationOverrides: overrides,
  });

  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].patch.integrationOverrides, overrides);
});

test("setChatIntegrationOverrides rejects missing chat", async () => {
  const { ctx } = buildCtx();
  await assert.rejects(
    (setChatIntegrationOverrides as any)._handler(ctx, {
      chatId: "missing",
      integrationOverrides: [],
    }),
    /not found/i,
  );
});

test("setChatIntegrationOverrides replaces entire array", async () => {
  const { ctx, patches } = buildCtx({ chat: makeChat() });

  await (setChatIntegrationOverrides as any)._handler(ctx, {
    chatId: "chat_1",
    integrationOverrides: [{ integrationId: "gmail", enabled: true }],
  });

  await (setChatIntegrationOverrides as any)._handler(ctx, {
    chatId: "chat_1",
    integrationOverrides: [{ integrationId: "notion", enabled: false }],
  });

  assert.equal(patches.length, 2);
  assert.deepEqual(patches[1].patch.integrationOverrides, [{ integrationId: "notion", enabled: false }]);
});
