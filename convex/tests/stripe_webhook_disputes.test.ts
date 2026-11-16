import assert from "node:assert/strict";
import test from "node:test";

import { updateStripeEntitlementStatus } from "../stripe/webhook";
import { extractStripeEntitlementUpdate } from "../stripe/webhook_helpers";

type Row = Record<string, any>;

function stripeCtx(rows: Row[]) {
  const runMutations: Row[] = [];
  const ctx = {
    db: {
      query: () => ({
        withIndex: (index: string, apply: (q: any) => unknown) => {
          const filters: Record<string, string> = {};
          const q: any = { eq: (field: string, value: string) => { filters[field] = value; return q; } };
          apply(q);
          const matching = () => rows.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
          return {
            collect: async () => (index === "by_external_purchase" ? matching() : rows.filter((row) => row.source === "stripe")),
            first: async () => matching()[0] ?? null,
          };
        },
      }),
      patch: async (id: string, patch: Row) => {
        Object.assign(rows.find((row) => row._id === id) ?? {}, patch);
      },
    },
    runMutation: async (_ref: unknown, args: Row) => {
      runMutations.push(args);
    },
  } as any;
  return { ctx, runMutations };
}

const disputeEvent = (type: string) => ({
  type,
  data: { object: { id: "dp_1", charge: "ch_1", payment_intent: "pi_1", status: "lost" } },
});

test("dispute funds withdrawn revokes and funds reinstated restores by charge and payment intent", () => {
  assert.deepEqual(extractStripeEntitlementUpdate(disputeEvent("charge.dispute.funds_withdrawn")), {
    kind: "revoke",
    status: "revoked",
    externalPurchaseIds: ["ch_1"],
    paymentIntentId: "pi_1",
    chargeId: "ch_1",
  });
  assert.deepEqual(extractStripeEntitlementUpdate(disputeEvent("charge.dispute.funds_reinstated")), {
    kind: "restore",
    externalPurchaseIds: ["ch_1"],
    paymentIntentId: "pi_1",
    chargeId: "ch_1",
  });
  // Expanded objects carry their IDs too; disputes without either ID are ignored.
  assert.equal(extractStripeEntitlementUpdate({
    type: "charge.dispute.funds_withdrawn",
    data: { object: { id: "dp_2", charge: { id: "ch_2" }, payment_intent: null } },
  })?.kind, "revoke");
  assert.equal(extractStripeEntitlementUpdate({
    type: "charge.dispute.funds_withdrawn",
    data: { object: { id: "dp_3", charge: null, payment_intent: null } },
  }), null);
  assert.equal(extractStripeEntitlementUpdate(disputeEvent("charge.dispute.created")), null);
});

test("a chargeback revokes the Stripe entitlement, disables Pro, and its reversal restores it", async () => {
  const rows: Row[] = [{
    _id: "ent_web", userId: "user_1", platform: "web", source: "stripe", status: "active",
    externalPurchaseId: "cs_1", metadata: { checkoutSessionId: "cs_1", paymentIntentId: "pi_1" },
  }];
  const { ctx, runMutations } = stripeCtx(rows);
  const withdrawn = { externalPurchaseIds: ["ch_1"], paymentIntentId: "pi_1", chargeId: "ch_1" };

  await (updateStripeEntitlementStatus as any)._handler(ctx, { ...withdrawn, status: "revoked", onlyFromStatus: "active" });
  assert.equal(rows[0].status, "revoked");
  assert.equal(typeof rows[0].revokedAt, "number");
  assert.deepEqual(runMutations, [{ userId: "user_1" }]);

  await (updateStripeEntitlementStatus as any)._handler(ctx, { ...withdrawn, status: "active", onlyFromStatus: "revoked" });
  assert.equal(rows[0].status, "active");
  assert.equal(rows[0].revokedAt, undefined);
  assert.equal(runMutations.length, 1, "restoring never runs the Pro cleanup");
});

test("a dispute reversal never reactivates a refunded purchase, and a dispute leaves refunds as they are", async () => {
  const rows: Row[] = [{
    _id: "ent_web", userId: "user_1", platform: "web", source: "stripe", status: "refunded",
    externalPurchaseId: "cs_1", revokedAt: 5, metadata: { paymentIntentId: "pi_1" },
  }];
  const { ctx, runMutations } = stripeCtx(rows);
  const match = { externalPurchaseIds: ["ch_1"], paymentIntentId: "pi_1", chargeId: "ch_1" };

  await (updateStripeEntitlementStatus as any)._handler(ctx, { ...match, status: "active", onlyFromStatus: "revoked" });
  await (updateStripeEntitlementStatus as any)._handler(ctx, { ...match, status: "revoked", onlyFromStatus: "active" });
  assert.equal(rows[0].status, "refunded");
  assert.equal(rows[0].revokedAt, 5);
  assert.equal(runMutations.length, 0);
});
