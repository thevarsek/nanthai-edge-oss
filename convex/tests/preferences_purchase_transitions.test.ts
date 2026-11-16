import assert from "node:assert/strict";
import test from "node:test";

import {
  revokeEntitlement,
  revokePlayEntitlement,
  syncEntitlement,
  syncPlayEntitlement,
} from "../preferences/mutations";

test("syncEntitlement schedules App Store verification instead of granting an entitlement", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      query: (table: string) => ({
        withIndex: (index: string, apply: (q: any) => unknown) => {
          apply({
            eq: () => ({ eq: () => ({}) }),
          });

          return {
            first: async () => {
              if (table === "purchaseEntitlements" && index === "by_external_purchase") {
                return null;
              }
              if (table === "userPreferences" && index === "by_user") {
                return null;
              }
              return null;
            },
            collect: async () => [],
          };
        },
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return `${table}_id`;
      },
      delete: async () => {},
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
  } as any;

  const result = await (syncEntitlement as any)._handler(ctx, {
    originalTransactionId: "tx_123",
  });

  assert.equal(result, "userPreferences_id");

  assert.ok(!inserts.some((entry) => entry.table === "purchaseEntitlements"));
  assert.deepEqual(scheduled, [{ userId: "user_1", transactionId: "tx_123" }]);

  const prefsInsert = inserts.find((entry) => entry.table === "userPreferences");
  assert.ok(prefsInsert);
  assert.equal(prefsInsert.value.isProUnlocked, undefined);
  assert.equal(prefsInsert.value.originalTransactionId, undefined);
  assert.equal(patches.length, 0);
});

test("syncPlayEntitlement schedules Play verification instead of granting an entitlement", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      query: (table: string) => ({
        withIndex: (index: string, apply: (q: any) => unknown) => {
          apply({
            eq: () => ({ eq: () => ({}) }),
          });

          return {
            first: async () => {
              if (table === "purchaseEntitlements" && index === "by_external_purchase") {
                return null;
              }
              if (table === "userPreferences" && index === "by_user") {
                return null;
              }
              return null;
            },
            collect: async () => [],
          };
        },
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return `${table}_id`;
      },
      delete: async () => {},
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
  } as any;

  const result = await (syncPlayEntitlement as any)._handler(ctx, {
    purchaseToken: "play_token_123",
    productId: "nanthai.pro.monthly",
    environment: "sandbox",
    packageName: "tech.nanthai.android",
  });

  assert.equal(result, "userPreferences_id");

  assert.ok(!inserts.some((entry) => entry.table === "purchaseEntitlements"));
  assert.deepEqual(scheduled, [{ userId: "user_1", purchaseToken: "play_token_123", productId: "nanthai.pro.monthly" }]);

  const prefsInsert = inserts.find((entry) => entry.table === "userPreferences");
  assert.ok(prefsInsert);
  assert.equal(prefsInsert.value.isProUnlocked, undefined);
  assert.equal(patches.length, 0);
});

test("revokeEntitlement revokes only app_store entitlements when another platform remains active", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      query: (table: string) => ({
        withIndex: (index: string, apply: (q: any) => unknown) => {
          apply({
            eq: () => ({ eq: () => ({}) }),
          });

          return {
            first: async () => {
              if (table === "purchaseEntitlements" && index === "by_user_status") {
                return { _id: "ent_android", source: "play_store" };
              }
              if (table === "userPreferences" && index === "by_user") {
                return { _id: "prefs_1" };
              }
              return null;
            },
            collect: async () => {
              if (table === "purchaseEntitlements" && index === "by_external_purchase") {
                return [
                  { _id: "ent_ios", userId: "user_1", source: "app_store" },
                ];
              }
              if (table === "chats" && index === "by_user") {
                return [{ _id: "chat_enabled", subagentOverride: "enabled" }];
              }
              return [];
            },
          };
        },
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
    scheduler: {
      runAfter: async () => {},
    },
  } as any;

  await (revokeEntitlement as any)._handler(ctx, { originalTransactionId: "tx_ios_123" });

  const entitlementPatchIds = patches
    .filter((entry) => Object.prototype.hasOwnProperty.call(entry.patch, "status"))
    .map((entry) => entry.id);
  assert.deepEqual(entitlementPatchIds, ["ent_ios"]);

  const prefsPatch = patches.find((entry) => entry.id === "prefs_1");
  assert.equal(prefsPatch, undefined);
});

test("revokePlayEntitlement revokes play_store entitlement and disables Pro-only preferences when no active entitlements remain", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const scheduled: Array<{ payload: Record<string, unknown> }> = [];

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      query: (table: string) => ({
        withIndex: (index: string, apply: (q: any) => unknown) => {
          apply({
            eq: () => ({ eq: () => ({}) }),
          });

          return {
            first: async () => {
              if (table === "purchaseEntitlements" && index === "by_user_status") {
                return null;
              }
              if (table === "userPreferences" && index === "by_user") {
                return { _id: "prefs_1" };
              }
              return null;
            },
            collect: async () => {
              if (table === "purchaseEntitlements" && index === "by_external_purchase") {
                return [{ _id: "ent_play", userId: "user_1", source: "play_store" }];
              }
              return [];
            },
          };
        },
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
    scheduler: {
      runAfter: async (_delay: number, _fnRef: unknown, payload: Record<string, unknown>) => {
        scheduled.push({ payload });
      },
    },
  } as any;

  await (revokePlayEntitlement as any)._handler(ctx, {
    purchaseToken: "play_token_123",
    status: "refunded",
  });

  const entitlementPatch = patches.find((entry) => entry.id === "ent_play");
  assert.ok(entitlementPatch);
  assert.equal(entitlementPatch.patch.status, "refunded");

  const prefsPatch = patches.find((entry) => entry.id === "prefs_1");
  assert.ok(prefsPatch);
  assert.equal(prefsPatch.patch.memoryGatingMode, "disabled");
  assert.equal(prefsPatch.patch.subagentsEnabledByDefault, false);

  // Chat subagentOverride resets are now done asynchronously via the
  // disableProChatsBatch scheduled mutation — assert it was scheduled.
  const chatBatchScheduled = scheduled.some((s) => s.payload.userId === "user_1");
  assert.ok(chatBatchScheduled);
});
