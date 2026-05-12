import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  deleteModelSettings,
  revokePlayEntitlement,
  setOnboardingCompleted,
  syncEntitlement,
  syncPlayEntitlement,
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

test("preferences creation uses server defaults when clients omit optional fields", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const ctx = {
    auth: auth(),
    db: {
      query: () => queryChain({ first: null }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "prefs_default";
      },
    },
  } as any;

  assert.equal(await (upsertPreferences as any)._handler(ctx, {}), "prefs_default");

  const value = inserts[0]?.value;
  assert.equal(value?.sendOnEnter, true);
  assert.equal(value?.showReasoning, true);
  assert.equal(value?.hapticFeedback, true);
  assert.equal(value?.appearanceMode, "light");
  assert.equal(value?.pickerFilterFree, false);
  assert.equal(value?.pickerFilterExcludeFree, false);
  assert.equal(value?.pickerFilterVision, false);
  assert.equal(value?.pickerFilterImageGen, false);
  assert.equal(value?.pickerFilterVideoGen, false);
  assert.equal(value?.pickerFilterTools, false);
  assert.equal(value?.webSearchEnabledByDefault, true);
  assert.equal(value?.subagentsEnabledByDefault, false);
  assert.equal(value?.chatCompletionNotificationsEnabled, false);
  assert.equal(value?.autoAudioResponse, false);
  assert.equal(value?.preferredVoice, "nova");
  assert.equal(value?.defaultAudioSpeed, 1);
  assert.equal(value?.isMemoryEnabled, true);
  assert.equal(value?.memoryGatingMode, "automatic");
});

test("model settings and onboarding create minimal default rows when optional fields are omitted", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const ctx = {
    auth: auth(),
    db: {
      query: () => queryChain({ first: null }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return table === "modelSettings" ? "settings_minimal" : "prefs_onboarding";
      },
    },
  } as any;

  assert.equal(await (upsertModelSettings as any)._handler(ctx, {
    openRouterId: "model_minimal",
  }), "settings_minimal");
  await (deleteModelSettings as any)._handler(ctx, { openRouterId: "missing_model" });
  assert.equal(await (setOnboardingCompleted as any)._handler(ctx, {}), "prefs_onboarding");

  assert.deepEqual(inserts[0]?.value, {
    userId: "user_1",
    openRouterId: "model_minimal",
    temperature: undefined,
    maxTokens: undefined,
    includeReasoning: undefined,
    reasoningEffort: undefined,
    updatedAt: inserts[0]?.value.updatedAt,
  });
  assert.equal(inserts[1]?.value.onboardingCompleted, true);
  assert.equal(inserts[1]?.value.subagentsEnabledByDefault, false);
});

test("entitlement duplicates and final Play revocation preserve ownership boundaries", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const externalMatches: Record<string, Array<Record<string, unknown>>> = {
    foreign_duplicate: [
      { _id: "canonical", userId: "user_1", source: "app_store", status: "active" },
      { _id: "foreign", userId: "other_user", source: "app_store", status: "active" },
    ],
    play_without_metadata: [],
    revoke_play: [
      { _id: "play_owned", userId: "user_1", source: "play_store", status: "active" },
      { _id: "ios_skip", userId: "user_1", source: "app_store", status: "active" },
      { _id: "play_foreign", userId: "other_user", source: "play_store", status: "active" },
    ],
  };

  const ctx = {
    auth: auth(),
    db: {
      query: (table: string) => ({
        withIndex: (index: string, apply?: (q: any) => unknown) => {
          let externalPurchaseId = "";
          apply?.({
            eq: (field: string, value: string) => {
              if (field === "externalPurchaseId") externalPurchaseId = value;
              return { eq: () => ({}) };
            },
            field: (name: string) => name,
          });
          return {
            first: async () => {
              if (table === "userPreferences") return { _id: "prefs_1", userId: "user_1" };
              if (table === "purchaseEntitlements" && index === "by_user_status") return null;
              return null;
            },
            collect: async () =>
              table === "purchaseEntitlements" && index === "by_external_purchase"
                ? (externalMatches[externalPurchaseId] ?? [])
                : [],
          };
        },
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return `${table}_${inserts.length}`;
      },
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
        return "sched_1";
      },
    },
  } as any;

  await assert.rejects(
    (syncEntitlement as any)._handler(ctx, { originalTransactionId: "foreign_duplicate" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "ENTITLEMENT_USER_MISMATCH",
  );

  await (syncPlayEntitlement as any)._handler(ctx, {
    purchaseToken: "play_without_metadata",
    productId: "nanthai.pro.monthly",
  });
  await (revokePlayEntitlement as any)._handler(ctx, { purchaseToken: "revoke_play" });

  assert.ok(inserts.some((entry) =>
    entry.table === "purchaseEntitlements"
      && entry.value.externalPurchaseId === "play_without_metadata"
      && entry.value.metadata === undefined));
  assert.ok(patches.some((entry) => entry.id === "play_owned" && entry.patch.status === "revoked"));
  assert.ok(!patches.some((entry) => entry.id === "ios_skip" || entry.id === "play_foreign"));
  assert.ok(patches.some((entry) =>
    entry.id === "prefs_1"
      && entry.patch.isMemoryEnabled === false
      && entry.patch.subagentsEnabledByDefault === false));
  assert.ok(scheduled.some((entry) => entry.userId === "user_1"));
});
