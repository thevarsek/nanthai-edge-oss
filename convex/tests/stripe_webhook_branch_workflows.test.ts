import assert from "node:assert/strict";
import test from "node:test";

import {
  grantProEntitlement,
  updateStripeEntitlementStatus,
} from "../stripe/webhook";
import {
  extractStripeEntitlementUpdate,
  verifyStripeSignature,
} from "../stripe/webhook_helpers";

async function stripeSignature(payload: string, secret: string, timestamp: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  return Array.from(new Uint8Array(sig))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

test("Stripe checkout events without Convex user metadata are ignored", () => {
  const result = extractStripeEntitlementUpdate({
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_123",
        payment_intent: null,
        metadata: {},
      },
    },
  });

  assert.equal(result, null);
});

test("full charge refunds revoke by charge id even without a payment intent", () => {
  const result = extractStripeEntitlementUpdate({
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_123",
        refunded: true,
        payment_intent: null,
      },
    },
  });

  assert.deepEqual(result, {
    kind: "revoke",
    status: "refunded",
    externalPurchaseIds: ["ch_123"],
    paymentIntentId: undefined,
    chargeId: "ch_123",
  });
});

test("Stripe signature verification accepts valid HMACs and rejects bad headers", async () => {
  const payload = JSON.stringify({ id: "evt_123", type: "charge.refunded" });
  const secret = "stripe-webhook-test-secret";
  const timestamp = "1710000000";
  const v1 = await stripeSignature(payload, secret, timestamp);

  assert.equal(
    await verifyStripeSignature(payload, `t=${timestamp},v1=${v1}`, secret),
    true,
  );
  assert.equal(await verifyStripeSignature(payload, `t=${timestamp}`, secret), false);
  assert.equal(
    await verifyStripeSignature(payload, `t=${timestamp},v1=invalid`, secret),
    false,
  );
});

test("grantProEntitlement is idempotent for existing Stripe checkout sessions", async () => {
  let insertCount = 0;
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => ({ _id: "ent_existing" }),
        }),
      }),
      insert: async () => {
        insertCount += 1;
      },
    },
  } as any;

  await (grantProEntitlement as any)._handler(ctx, {
    userId: "user_1",
    stripeSessionId: "cs_existing",
  });

  assert.equal(insertCount, 0);
});

test("active Stripe reconciliation skips non-web purchases and preserves Pro state", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const runMutations: Array<Record<string, unknown>> = [];

  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: (index: string, apply: (q: any) => unknown) => {
          let userId = "";
          let status = "";
          apply({
            eq: (field: string, value: string) => {
              if (field === "userId") userId = value;
              if (field === "status") status = value;
              return {
                eq: (field2: string, value2: string) => {
                  if (field2 === "status") status = value2;
                  return {};
                },
              };
            },
          });

          return {
            collect: async () => {
              if (table === "purchaseEntitlements" && index === "by_external_purchase") {
                return [
                  { _id: "ios", platform: "ios", source: "app_store", userId: "user_1" },
                  { _id: "web", platform: "web", source: "stripe", userId: "user_1" },
                ];
              }
              return [];
            },
            first: async () =>
              table === "purchaseEntitlements" &&
              index === "by_user_status" &&
              userId === "user_1" &&
              status === "active"
                ? { _id: "ent_active" }
                : null,
          };
        },
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
    runMutation: async (_name: unknown, args: Record<string, unknown>) => {
      runMutations.push(args);
    },
  } as any;

  await (updateStripeEntitlementStatus as any)._handler(ctx, {
    externalPurchaseIds: ["cs_123"],
    status: "active",
  });

  assert.deepEqual(patches.map((patch) => patch.id), ["web"]);
  assert.equal(patches[0]?.patch.status, "active");
  assert.equal(patches[0]?.patch.revokedAt, undefined);
  assert.equal(runMutations.length, 0);
});
