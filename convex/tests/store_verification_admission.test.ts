import assert from "node:assert/strict";
import test from "node:test";

import { syncEntitlement } from "../preferences/mutations";
import {
  admitStoreVerification,
  cleanupStoreVerificationAttempts,
  markStoreVerificationRejected,
  STORE_REJECTION_CACHE_MS,
  STORE_VERIFICATIONS_PER_HOUR,
} from "../preferences/store_verification_admission";
import { sha256Hex } from "../scheduledJobs/trigger_auth";

type Attempt = { _id: string; userId: string; store: string; purchaseKey: string; createdAt: number; rejectedAt?: number };

function attemptsCtx(attempts: Attempt[]) {
  const scheduled: Record<string, unknown>[] = [];
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    db: {
      get: async (id: string) => attempts.find((attempt) => attempt._id === id) ?? null,
      query: (table: string) => ({
        withIndex: (index: string, apply: (q: any) => unknown) => {
          let userId: string | undefined;
          let after = -Infinity;
          let before = Infinity;
          const q: any = {
            eq: (field: string, value: string) => { if (field === "userId") userId = value; return q; },
            gt: (_field: string, value: number) => { after = value; return q; },
            lt: (_field: string, value: number) => { before = value; return q; },
          };
          apply(q);
          const rows = () => table !== "storeVerificationAttempts" ? [] : attempts.filter((attempt) =>
            (index !== "by_user" || attempt.userId === userId) && attempt.createdAt > after && attempt.createdAt < before);
          return {
            take: async (count: number) => rows().slice(0, count),
            first: async () => (table === "userPreferences" ? { _id: "prefs_1" } : null),
            collect: async () => [],
          };
        },
      }),
      insert: async (_table: string, value: Omit<Attempt, "_id">) => {
        const row = { _id: `attempt_${attempts.length + 1}`, ...value };
        attempts.push(row);
        return row._id;
      },
      patch: async (id: string, patch: Partial<Attempt>) => {
        Object.assign(attempts.find((attempt) => attempt._id === id) ?? {}, patch);
      },
      delete: async (id: string) => {
        attempts.splice(attempts.findIndex((attempt) => attempt._id === id), 1);
      },
    },
    scheduler: { runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => { scheduled.push(args); } },
  } as any;
  return { ctx, scheduled };
}

test("admitStoreVerification allows ten lookups per user per hour", async () => {
  const now = 10 * 60 * 60 * 1000;
  const attempts: Attempt[] = [];
  const { ctx } = attemptsCtx(attempts);
  for (let index = 0; index < STORE_VERIFICATIONS_PER_HOUR; index += 1) {
    assert.ok(await admitStoreVerification(ctx, { userId: "user_1", store: "app_store", purchaseId: `${index}`, now }));
  }
  assert.equal(await admitStoreVerification(ctx, { userId: "user_1", store: "app_store", purchaseId: "next", now }), null);
  // Other users and attempts older than an hour do not count.
  assert.ok(await admitStoreVerification(ctx, { userId: "user_2", store: "app_store", purchaseId: "next", now }));
  assert.ok(await admitStoreVerification(ctx, { userId: "user_1", store: "app_store", purchaseId: "later", now: now + 60 * 60 * 1000 + 1 }));
  assert.equal(attempts.some((attempt) => attempt.purchaseKey.includes("later")), false, "identifiers are hashed");
});

test("a rejected identifier is not looked up again for ten minutes", async () => {
  const now = 1_000_000_000;
  const purchaseKey = await sha256Hex("play_store:token_1");
  const attempts: Attempt[] = [{
    _id: "attempt_1", userId: "user_1", store: "play_store", purchaseKey, createdAt: now - 1000, rejectedAt: now - 500,
  }];
  const { ctx } = attemptsCtx(attempts);
  const args = { userId: "user_1", store: "play_store" as const, purchaseId: "token_1" };
  assert.equal(await admitStoreVerification(ctx, { ...args, now }), null);
  assert.ok(await admitStoreVerification(ctx, { ...args, purchaseId: "token_2", now }));
  assert.ok(await admitStoreVerification(ctx, { ...args, store: "app_store", now }), "the cache is per store");
  assert.ok(await admitStoreVerification(ctx, { ...args, now: now - 500 + STORE_REJECTION_CACHE_MS }));
});

test("syncEntitlement returns normally without scheduling once the user is over the limit", async () => {
  const now = Date.now();
  const attempts: Attempt[] = Array.from({ length: STORE_VERIFICATIONS_PER_HOUR }, (_, index) => ({
    _id: `attempt_${index}`, userId: "user_1", store: "app_store", purchaseKey: `k${index}`, createdAt: now - 1000,
  }));
  const { ctx, scheduled } = attemptsCtx(attempts);
  assert.equal(await (syncEntitlement as any)._handler(ctx, { originalTransactionId: "123" }), "prefs_1");
  assert.deepEqual(scheduled, []);
  assert.equal(attempts.length, STORE_VERIFICATIONS_PER_HOUR);
});

test("rejections are recorded and day-old attempts are cleaned up", async () => {
  const now = Date.now();
  const attempts: Attempt[] = [
    { _id: "old", userId: "user_1", store: "app_store", purchaseKey: "a", createdAt: now - 25 * 60 * 60 * 1000 },
    { _id: "new", userId: "user_1", store: "app_store", purchaseKey: "b", createdAt: now - 1000 },
  ];
  const { ctx } = attemptsCtx(attempts);
  await (markStoreVerificationRejected as any)._handler(ctx, { attemptId: "new" });
  assert.equal(typeof attempts.find((attempt) => attempt._id === "new")?.rejectedAt, "number");
  assert.equal(await (cleanupStoreVerificationAttempts as any)._handler(ctx, {}), 1);
  assert.deepEqual(attempts.map((attempt) => attempt._id), ["new"]);
});
