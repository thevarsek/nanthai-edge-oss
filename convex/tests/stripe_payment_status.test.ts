import assert from "node:assert/strict";
import test from "node:test";
import { extractStripeEntitlementUpdate } from "../stripe/webhook_helpers";

function event(type: string, payment_status: string | undefined, mode = "payment") {
  return { id: "evt_checkout", object: "event", api_version: "2025-06-30.basil", type,
    data: { object: { object: "checkout.session", id: "cs_live_shape", mode,
      payment_status, payment_intent: "pi_live_shape", amount_total: 2999, currency: "eur",
      metadata: { convexUserId: "user_1" }, status: "complete" } } };
}
for (const type of ["checkout.session.completed", "checkout.session.async_payment_succeeded"]) {
  test(`${type} grants only paid one-time Checkout sessions`, () => {
    for (const status of ["unpaid", "no_payment_required", undefined, "unknown"]) {
      assert.equal(extractStripeEntitlementUpdate(event(type, status)), null);
    }
    assert.equal(extractStripeEntitlementUpdate(event(type, "paid", "subscription")), null);
    assert.deepEqual(extractStripeEntitlementUpdate(event(type, "paid")), {
      kind: "grant", userId: "user_1", stripeSessionId: "cs_live_shape", paymentIntentId: "pi_live_shape",
    });
  });
}
test("delayed failure never grants Pro, including inconsistent payment metadata", () => {
  assert.equal(extractStripeEntitlementUpdate(event("checkout.session.async_payment_failed", "unpaid")), null);
  assert.equal(extractStripeEntitlementUpdate(event("checkout.session.async_payment_failed", "paid")), null);
});
