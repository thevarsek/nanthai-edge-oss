import assert from "node:assert/strict";
import test from "node:test";

import {
  grantProEntitlement,
  updateStripeEntitlementStatus,
} from "../stripe/webhook";
import { extractStripeEntitlementUpdate } from "../stripe/webhook_helpers";

test("extractStripeEntitlementUpdate returns grant payload for checkout completion", () => {
  const result = extractStripeEntitlementUpdate({
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_123",
        payment_intent: "pi_123",
        metadata: { convexUserId: "user_1" },
      },
    },
  });

  assert.deepEqual(result, {
    kind: "grant",
    userId: "user_1",
    stripeSessionId: "cs_123",
    paymentIntentId: "pi_123",
  });
});

test("extractStripeEntitlementUpdate ignores non-succeeded refunds", () => {
  const result = extractStripeEntitlementUpdate({
    type: "refund.updated",
    data: {
      object: {
        id: "re_123",
        payment_intent: "pi_123",
        charge: "ch_123",
        status: "pending",
      },
    },
  });

  assert.equal(result, null);
});

test("extractStripeEntitlementUpdate ignores refund events even when succeeded", () => {
  const result = extractStripeEntitlementUpdate({
    type: "refund.updated",
    data: {
      object: {
        id: "re_123",
        payment_intent: "pi_123",
        charge: "ch_123",
        status: "succeeded",
      },
    },
  });

  assert.equal(result, null);
});

test("extractStripeEntitlementUpdate ignores partial charge refunds", () => {
  const result = extractStripeEntitlementUpdate({
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_123",
        refunded: false,
        amount_refunded: 100,
        payment_intent: "pi_123",
      },
    },
  });

  assert.equal(result, null);
});

test("extractStripeEntitlementUpdate revokes on fully refunded charges", () => {
  const result = extractStripeEntitlementUpdate({
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_123",
        refunded: true,
        amount_refunded: 499,
        payment_intent: "pi_123",
      },
    },
  });

  assert.deepEqual(result, {
    kind: "revoke",
    status: "refunded",
    externalPurchaseIds: ["ch_123"],
    paymentIntentId: "pi_123",
    chargeId: "ch_123",
  });
});

test("grantProEntitlement stores payment intent metadata", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => null,
        }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "ent_1";
      },
    },
  } as any;

  await (grantProEntitlement as any)._handler(ctx, {
    userId: "user_1",
    stripeSessionId: "cs_123",
    paymentIntentId: "pi_123",
  });

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0]?.table, "purchaseEntitlements");
  assert.deepEqual(inserts[0]?.value.metadata, {
    checkoutSessionId: "cs_123",
    paymentIntentId: "pi_123",
  });
});

test("updateStripeEntitlementStatus matches Stripe web entitlements via metadata fallback and disables Pro when needed", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const runMutations: Array<{ name: unknown; args: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: (index: string, apply: (q: any) => unknown) => {
          let userId: string | null = null;
          let status: string | null = null;
          apply({
            eq: (_field: string, value: string) => ({
              eq: (field2: string, value2: string) => {
                if (_field === "userId") userId = value;
                if (field2 === "status") status = value2;
                return {};
              },
            }),
          });

          return {
            collect: async () => {
              if (table === "purchaseEntitlements" && index === "by_external_purchase") {
                return [];
              }
              if (table === "purchaseEntitlements" && index === "by_platform_source") {
                return [
                  {
                    _id: "ent_web",
                    userId: "user_1",
                    platform: "web",
                    source: "stripe",
                    metadata: { paymentIntentId: "pi_123" },
                  },
                ];
              }
              return [];
            },
            first: async () => {
              if (
                table === "purchaseEntitlements" &&
                index === "by_user_status" &&
                userId === "user_1" &&
                status === "active"
              ) {
                return null;
              }
              return null;
            },
          };
        },
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
    runMutation: async (name: string, args: Record<string, unknown>) => {
      runMutations.push({ name, args });
    },
  } as any;

  await (updateStripeEntitlementStatus as any)._handler(ctx, {
    externalPurchaseIds: ["re_123"],
    paymentIntentId: "pi_123",
    chargeId: "ch_123",
    status: "refunded",
  });

  assert.equal(patches.length, 1);
  assert.equal(patches[0]?.id, "ent_web");
  assert.equal(patches[0]?.patch.status, "refunded");
  assert.equal(runMutations.length, 1);
  assert.ok(runMutations[0]?.name);
  assert.deepEqual(runMutations[0]?.args, { userId: "user_1" });
});
