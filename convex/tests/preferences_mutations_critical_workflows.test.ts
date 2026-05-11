import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  deleteModelSettings,
  disableProChatsBatch,
  ensureUserPreferences,
  ensureUserPreferencesInternal,
  grantManualPro,
  removeIntegrationDefault,
  removeSkillDefault,
  revokeManualPro,
  setIntegrationDefault,
  setOnboardingCompleted,
  setSkillDefault,
  syncEntitlement,
  upsertModelSettings,
  upsertPreferences,
} from "../preferences/mutations";
function auth(userId = "user_1") {
  return { getUserIdentity: async () => ({ subject: userId }) };
}
function queryChain(result: { first?: unknown; collect?: unknown[] }) {
  return {
    withIndex: (_index: string, apply?: (q: any) => unknown) => {
      apply?.({ eq: () => ({ eq: () => ({}) }), field: (name: string) => name });
      return {
        filter: () => ({ first: async () => result.first ?? null, collect: async () => result.collect ?? [] }),
        first: async () => result.first ?? null,
        unique: async () => result.first ?? null,
        collect: async () => result.collect ?? [],
        take: async () => result.collect ?? [],
      };
    },
  };
}
test("preferences create, patch, clear nullable fields, and enforce Pro for subagents", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  let existingPrefs: Record<string, unknown> | null = null;

  const ctx = {
    auth: auth(),
    db: {
      query: (table: string) => {
        if (table === "purchaseEntitlements") return queryChain({ first: { _id: "ent_1", status: "active" } });
        if (table === "userPreferences") return queryChain({ first: existingPrefs });
        return queryChain({});
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        existingPrefs = { _id: "prefs_1", ...value };
        return "prefs_1";
      },
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
    },
  } as any;

  const created = await (upsertPreferences as any)._handler(ctx, {
    defaultModelId: "model_1",
    defaultPersonaId: "persona_1",
    sendOnEnter: false,
    showReasoning: false,
    hapticFeedback: false,
    appearanceMode: "dark",
    colorTheme: "teal",
    defaultTemperature: 0.7,
    defaultMaxTokens: 1024,
    includeReasoning: true,
    reasoningEffort: "high",
    pickerFilterFree: true,
    pickerFilterExcludeFree: true,
    pickerFilterVision: true,
    pickerFilterImageGen: true,
    pickerFilterVideoGen: true,
    pickerFilterTools: true,
    pickerSortPrimaryKey: "price",
    pickerSortPrimaryDirection: "asc",
    pickerSortSecondaryKey: "context",
    pickerSortSecondaryDirection: "desc",
    webSearchEnabledByDefault: false,
    subagentsEnabledByDefault: true,
    chatCompletionNotificationsEnabled: true,
    defaultSearchMode: "web",
    defaultSearchComplexity: 2,
    autoAudioResponse: true,
    preferredVoice: "alloy",
    defaultAudioSpeed: 1.25,
    isMemoryEnabled: false,
    memoryGatingMode: "manual",
    memoryExtractionModelId: "memory_model",
    titleModelId: "title_model",
    disabledProviders: ["x"],
    hasSeenIdeascapeHelp: true,
    hasSeenMainWalkthrough: true,
    showBalanceInChat: true,
    showAdvancedStats: true,
    defaultVideoAspectRatio: "16:9",
    defaultVideoDuration: 10,
    defaultVideoResolution: "720p",
    defaultVideoGenerateAudio: false,
  });

  assert.equal(created, "prefs_1");
  assert.equal(inserts[0]?.value.defaultPersonaId, "persona_1");
  assert.equal(inserts[0]?.value.subagentsEnabledByDefault, true);

  await (upsertPreferences as any)._handler(ctx, {
    clearDefaultPersona: true,
    defaultTemperature: null,
    colorTheme: null,
    disabledProviders: null,
    defaultSearchMode: null,
  });

  assert.equal(patches[0]?.patch.defaultPersonaId, undefined);
  assert.equal(patches[0]?.patch.defaultTemperature, undefined);
  assert.equal(patches[0]?.patch.colorTheme, undefined);

  await assert.rejects(
    (upsertPreferences as any)._handler({
      auth: auth("free_user"),
      db: { query: () => queryChain({ first: null }) },
    }, { subagentsEnabledByDefault: true }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "PRO_REQUIRED",
  );
});

test("global skill and integration defaults insert, update, and remove sparse preference entries", async () => {
  const inserts: Array<Record<string, unknown>> = [];
  const patches: Array<Record<string, unknown>> = [];
  let prefs: Record<string, unknown> | null = null;

  const ctx = {
    auth: auth(),
    db: {
      query: (table: string) => {
        if (table === "purchaseEntitlements") return queryChain({ first: { _id: "ent_1", status: "active" } });
        if (table === "userPreferences") return queryChain({ first: prefs });
        return queryChain({});
      },
      insert: async (_table: string, value: Record<string, unknown>) => {
        inserts.push(value);
        prefs = { _id: "prefs_1", ...value };
        return "prefs_1";
      },
      patch: async (_id: string, patch: Record<string, unknown>) => {
        patches.push(patch);
        prefs = { _id: "prefs_1", ...(prefs ?? {}), ...patch };
      },
    },
  } as any;

  await (setSkillDefault as any)._handler(ctx, { skillId: "skill_1", state: "always" });
  await (setSkillDefault as any)._handler(ctx, { skillId: "skill_1", state: "never" });
  await (setIntegrationDefault as any)._handler(ctx, { integrationId: "notion", enabled: true });
  await (setIntegrationDefault as any)._handler(ctx, { integrationId: "notion", enabled: false });
  await (removeSkillDefault as any)._handler(ctx, { skillId: "skill_1" });
  await (removeIntegrationDefault as any)._handler(ctx, { integrationId: "notion" });

  assert.deepEqual(inserts[0]?.skillDefaults, [{ skillId: "skill_1", state: "always" }]);
  assert.deepEqual(patches[0]?.skillDefaults, [{ skillId: "skill_1", state: "never" }]);
  assert.deepEqual(patches[2]?.integrationDefaults, [{ integrationId: "notion", enabled: false }]);
  assert.equal(patches.at(-2)?.skillDefaults, undefined);
  assert.equal(patches.at(-1)?.integrationDefaults, undefined);
});

test("model settings, onboarding, and ensure helpers cover existing and missing preference rows", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deleted: string[] = [];
  let prefs: Record<string, unknown> | null = null;
  let modelSettings: Record<string, unknown> | null = null;

  const ctx = {
    auth: auth(),
    db: {
      query: (table: string) => {
        if (table === "userPreferences") return queryChain({ first: prefs });
        if (table === "modelSettings") return queryChain({ first: modelSettings });
        return queryChain({});
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        if (table === "userPreferences") prefs = { _id: "prefs_1", ...value };
        if (table === "modelSettings") modelSettings = { _id: "settings_1", ...value };
        return table === "modelSettings" ? "settings_1" : "prefs_1";
      },
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
      delete: async (id: string) => deleted.push(id),
    },
  } as any;

  assert.equal(await (ensureUserPreferences as any)._handler(ctx, {}), "prefs_1");
  assert.equal(await (ensureUserPreferencesInternal as any)._handler(ctx, { userId: "user_1" }), "prefs_1");
  assert.equal(await (upsertModelSettings as any)._handler(ctx, {
    openRouterId: "model_1",
    temperature: 0.5,
    maxTokens: 100,
    includeReasoning: true,
    reasoningEffort: "medium",
  }), "settings_1");
  await (upsertModelSettings as any)._handler(ctx, {
    openRouterId: "model_1",
    temperature: null,
    maxTokens: null,
    includeReasoning: null,
    reasoningEffort: null,
  });
  await (deleteModelSettings as any)._handler(ctx, { openRouterId: "model_1" });
  await (setOnboardingCompleted as any)._handler(ctx, {});

  assert.ok(patches.some((entry) => entry.patch.temperature === undefined));
  assert.deepEqual(deleted, ["settings_1"]);
});

test("entitlement sync detects cross-account duplicates and manual grants are idempotent", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deleted: string[] = [];
  let activeManual: Record<string, unknown> | null = null;

  const ctx = {
    auth: auth(),
    db: {
      query: (table: string) => ({
        withIndex: (_index: string, apply?: (q: any) => unknown) => {
          apply?.({ eq: () => ({ eq: () => ({}) }), field: (name: string) => name });
          return {
            filter: () => ({
              first: async () => activeManual,
              collect: async () => activeManual ? [activeManual] : [],
            }),
            first: async () => (table === "userPreferences" ? null : activeManual),
            collect: async () => table === "purchaseEntitlements" && !activeManual
              ? [{ _id: "ent_other", userId: "other_user" }]
              : [],
          };
        },
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        activeManual = { _id: "manual_1", ...value };
        return "manual_1";
      },
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
      delete: async (id: string) => deleted.push(id),
    },
    runMutation: async () => "prefs_1",
  } as any;

  await assert.rejects(
    (syncEntitlement as any)._handler(ctx, { originalTransactionId: "already_linked" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "ENTITLEMENT_USER_MISMATCH",
  );

  activeManual = null;
  ctx.db.query = () => queryChain({ first: activeManual, collect: [] }) as any;
  assert.equal(await (grantManualPro as any)._handler(ctx, { userId: "user_1", reason: "tester" }), "manual_1");
  assert.equal(await (grantManualPro as any)._handler(ctx, { userId: "user_1", reason: "tester" }), "manual_1");
  ctx.db.query = () => ({
    withIndex: () => ({
      filter: () => ({ collect: async () => [activeManual] }),
      collect: async () => [activeManual],
      first: async () => activeManual,
    }),
  }) as any;
  assert.equal(await (revokeManualPro as any)._handler(ctx, { userId: "user_1" }), 1);

  assert.ok(inserts.some((entry) => entry.value.source === "manual"));
  assert.ok(patches.some((entry) => entry.patch.status === "revoked"));
  assert.deepEqual(deleted, []);
});

test("disableProChatsBatch clears full batches and schedules continuation only when needed", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const fullBatch = Array.from({ length: 200 }, (_, index) => ({ _id: `chat_${index}` }));
  let batch = fullBatch;

  const ctx = {
    db: {
      query: () => queryChain({ collect: batch }),
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, payload: Record<string, unknown>) => scheduled.push(payload),
    },
  } as any;

  await (disableProChatsBatch as any)._handler(ctx, { userId: "user_1", now: 123 });
  batch = [{ _id: "chat_last" }];
  await (disableProChatsBatch as any)._handler(ctx, { userId: "user_1", now: 456 });

  assert.equal(patches.length, 201);
  assert.deepEqual(scheduled, [{ userId: "user_1", now: 123 }]);
  assert.equal(patches[0]?.patch.subagentOverride, undefined);
});
