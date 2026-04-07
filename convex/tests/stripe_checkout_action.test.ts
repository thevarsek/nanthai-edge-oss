import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import { createCheckoutSession } from "../stripe/actions";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

test("createCheckoutSession trims the app URL and sends user metadata to Stripe", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const requests: RequestInit[] = [];

  try {
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_PRICE_ID = "price_123";
    process.env.WEB_APP_URL = "https://app.example/";

    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return {
        ok: true,
        json: async () => ({ url: "https://checkout.stripe.com/session" }),
      } as Response;
    }) as typeof fetch;

    const result = await (createCheckoutSession as any)._handler({
      auth: buildAuth("user_42"),
    }, {});
    const body = new URLSearchParams(String(requests[0]?.body ?? ""));

    assert.deepEqual(result, { url: "https://checkout.stripe.com/session" });
    assert.equal(body.get("success_url"), "https://app.example/app/settings?pro=success");
    assert.equal(body.get("cancel_url"), "https://app.example/app/settings?pro=cancelled");
    assert.equal(body.get("metadata[convexUserId]"), "user_42");
    assert.equal(body.get("payment_intent_data[metadata][convexUserId]"), "user_42");
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test("createCheckoutSession surfaces upstream Stripe failures", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  try {
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_PRICE_ID = "price_123";
    process.env.WEB_APP_URL = "https://app.example";
    globalThis.fetch = (async () => ({
      ok: false,
      status: 500,
      text: async () => "stripe exploded",
    })) as unknown as typeof fetch;

    await assert.rejects(
      (createCheckoutSession as any)._handler({
        auth: buildAuth("user_42"),
      }, {}),
      (error: unknown) => {
        assert.ok(error instanceof ConvexError);
        return (error as ConvexError<any>).data?.code === "EXTERNAL_SERVICE";
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});
