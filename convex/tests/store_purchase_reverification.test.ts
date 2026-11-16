import assert from "node:assert/strict";
import test from "node:test";

import {
  applyStoreReverification,
  classifyReverification,
  MAX_PAGES_PER_STORE,
  MAX_RETRYABLE_PER_STORE,
  reverifyStore,
  type StaleEntitlement,
} from "../preferences/store_purchase_reverification";
import type { StoreVerification } from "../preferences/store_purchase_verification";

const reject = (reason: string, retryable = false): StoreVerification => ({ ok: false, reason, retryable });
const ok: StoreVerification = { ok: true, productId: "p", externalPurchaseId: "x", environment: "Production" };
const row = (id: string): StaleEntitlement => ({ _id: id as any, externalPurchaseId: `purchase_${id}`, productId: "p" });

test("classifyReverification revokes only on a definitive store answer", () => {
  assert.equal(classifyReverification(ok), "verified");
  assert.equal(classifyReverification(reject("test_purchase")), "verified");
  assert.equal(classifyReverification(reject("revoked")), "refunded");
  assert.equal(classifyReverification(reject("not_purchased")), "refunded");
  assert.equal(classifyReverification(reject("transaction_not_found")), "revoked");
  assert.equal(classifyReverification(reject("token_not_found")), "revoked");
  for (const reason of ["pending", "bundle_mismatch", "product_not_pro", "malformed_transaction_id", "app_store_http_500"]) {
    assert.equal(classifyReverification(reject(reason)), "skip", reason);
  }
});

test("reverifyStore pages, applies each outcome, and skips retryable or ambiguous answers", async () => {
  const answers: Record<string, StoreVerification | Error> = {
    a: ok,
    b: reject("test_purchase"),
    c: reject("revoked"),
    d: reject("token_not_found"),
    e: reject("app_store_http_503", true),
    f: reject("pending"),
    g: new Error("network down"),
  };
  const pages = [[row("a"), row("b"), row("c")], [row("d"), row("e"), row("f"), row("g")]];
  const cursors: Array<string | null> = [];
  const applied: Array<[string, string]> = [];

  const counts = await reverifyStore({
    store: "play_store",
    listPage: async (cursor) => {
      cursors.push(cursor);
      const index = cursor === null ? 0 : 1;
      return { page: pages[index], continueCursor: `c${index + 1}`, isDone: index === 1 };
    },
    verify: async (entry) => {
      const answer = answers[String(entry._id)];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    apply: async (entry, outcome) => {
      applied.push([String(entry._id), outcome]);
    },
  });

  assert.deepEqual(cursors, [null, "c1"]);
  assert.deepEqual(applied, [["a", "verified"], ["b", "verified"], ["c", "refunded"], ["d", "revoked"]]);
  assert.deepEqual(
    { checked: counts.checked, verified: counts.verified, refunded: counts.refunded, revoked: counts.revoked,
      skipped: counts.skipped, retryable: counts.retryable, reachedPageLimit: counts.reachedPageLimit },
    { checked: 7, verified: 2, refunded: 1, revoked: 1, skipped: 1, retryable: 2, reachedPageLimit: false },
  );
  assert.deepEqual(counts.reasons, {
    test_purchase: 1, revoked: 1, token_not_found: 1, app_store_http_503: 1, pending: 1, verification_error: 1,
  });
  assert.equal(JSON.stringify(counts).includes("purchase_"), false, "counts never carry identifiers");
});

test("reverifyStore stops on repeated retryable errors and at the page limit", async () => {
  let verifyCalls = 0;
  const throttled = await reverifyStore({
    store: "app_store",
    listPage: async () => ({ page: Array.from({ length: 20 }, (_, i) => row(`r${i}`)), continueCursor: "next", isDone: false }),
    verify: async () => {
      verifyCalls += 1;
      return reject("app_store_http_429", true);
    },
    apply: async () => assert.fail("nothing is applied on retryable errors"),
  });
  assert.equal(verifyCalls, MAX_RETRYABLE_PER_STORE);
  assert.equal(throttled.retryable, MAX_RETRYABLE_PER_STORE);

  let pagesRead = 0;
  const bounded = await reverifyStore({
    store: "app_store",
    listPage: async () => {
      pagesRead += 1;
      return { page: [row(`p${pagesRead}`)], continueCursor: "next", isDone: false };
    },
    verify: async () => ok,
    apply: async () => undefined,
  });
  assert.equal(pagesRead, MAX_PAGES_PER_STORE);
  assert.equal(bounded.reachedPageLimit, true);
});

function mutationCtx(rows: Record<string, any>[]) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const scheduled: Record<string, unknown>[] = [];
  const ctx = {
    db: {
      get: async (id: string) => rows.find((entry) => entry._id === id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
        Object.assign(rows.find((entry) => entry._id === id) ?? {}, patch);
      },
      query: (table: string) => ({
        withIndex: (_index: string, apply: (q: any) => unknown) => {
          const filters: Record<string, string> = {};
          const q: any = { eq: (field: string, value: string) => { filters[field] = value; return q; } };
          apply(q);
          const candidates = table === "purchaseEntitlements" ? rows : [];
          return {
            first: async () => candidates.find((entry) => Object.entries(filters).every(([k, v]) => entry[k] === v)) ?? null,
          };
        },
      }),
    },
    scheduler: { runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => { scheduled.push(args); } },
  } as any;
  return { ctx, patches, scheduled };
}

test("applyStoreReverification refreshes verified rows and removes Pro when the last entitlement goes", async () => {
  const rows = [
    { _id: "ent_ios", userId: "user_1", status: "active", lastVerifiedAt: 1 },
    { _id: "ent_play", userId: "user_1", status: "active", lastVerifiedAt: 1 },
  ];
  const { ctx, patches, scheduled } = mutationCtx(rows);

  await (applyStoreReverification as any)._handler(ctx, { entitlementId: "ent_ios", outcome: "verified" });
  assert.equal(rows[0].status, "active");
  assert.ok(rows[0].lastVerifiedAt > 1);

  await (applyStoreReverification as any)._handler(ctx, { entitlementId: "ent_ios", outcome: "refunded" });
  assert.equal(rows[0].status, "refunded");
  assert.equal(scheduled.length, 0, "another active entitlement keeps Pro");

  await (applyStoreReverification as any)._handler(ctx, { entitlementId: "ent_play", outcome: "revoked" });
  assert.equal(rows[1].status, "revoked");
  assert.equal(typeof (rows[1] as any).revokedAt, "number");
  assert.ok(scheduled.some((args) => args.userId === "user_1"), "Pro cleanup is scheduled");

  const before = patches.length;
  await (applyStoreReverification as any)._handler(ctx, { entitlementId: "ent_play", outcome: "verified" });
  assert.equal(patches.length, before, "rows no longer active are left alone");
});
