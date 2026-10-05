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

test("local runtime checkout returns to the requested setup with the Mac handoff preserved", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  try {
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_PRICE_ID = "price_123";
    process.env.WEB_APP_URL = "https://app.example";
    let body = new URLSearchParams();
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      body = new URLSearchParams(String(init?.body));
      return { ok: true, json: async () => ({ url: "https://checkout.stripe.com/session" }) } as Response;
    }) as typeof fetch;
    const handler = (createCheckoutSession as any)._handler;
    const ctx = { auth: buildAuth("user_42") };
    for (const kind of ["local-runtime", "onboarding"] as const) {
      await handler(ctx, { checkoutContext: { kind } });
      const success = new URL(body.get("success_url")!);
      assert.equal(success.pathname, kind === "local-runtime" ? "/app/settings/local-runtime" : "/onboarding");
      assert.equal(success.searchParams.get("pro"), "success");
      if (kind === "onboarding") assert.equal(success.searchParams.get("mode"), "connections");
    }
    await handler(ctx, { checkoutContext: { kind: "runtime-connect", state: "01234567-89ab-cdef", computer: "Dino’s Mac & Co" } });
    for (const [key, result] of [["success_url", "success"], ["cancel_url", "cancelled"]]) {
      const url = new URL(body.get(key)!);
      assert.equal(url.origin, "https://app.example");
      assert.equal(url.pathname, "/runtime/connect");
      assert.equal(url.searchParams.get("state"), "01234567-89ab-cdef");
      assert.equal(url.searchParams.get("computer"), "Dino’s Mac & Co");
      assert.equal(url.searchParams.get("pro"), result);
    }
    await assert.rejects(handler(ctx, { checkoutContext: { kind: "runtime-connect", state: "https://other.site", computer: "Mac" } }), /Restart the connection/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});
