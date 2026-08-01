import assert from "node:assert/strict";
import test from "node:test";
import { exchangeAndStore } from "../oauth/openrouter";

test("OpenRouter exchange returns only connection status and persists a v2 envelope", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.CONVEX_SECRET_ENCRYPTION_KEY;
  process.env.CONVEX_SECRET_ENCRYPTION_KEY = "test-openrouter-encryption-key";
  const mutations: Array<Record<string, unknown>> = [];
  globalThis.fetch = async () => new Response(
    JSON.stringify({ key: "sk-or-sensitive" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  try {
    const result = await (exchangeAndStore as any)._handler({
      auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
      runQuery: async () => null,
      runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
        return true;
      },
    }, { code: "one-time-code", codeVerifier: "a".repeat(64) });

    assert.deepEqual(result, { connected: true });
    assert.deepEqual(Object.keys(result), ["connected"]);
    assert.equal(String(mutations[1]?.encryptedApiKey).startsWith("enc:v2:k1:"), true);
    assert.equal(JSON.stringify(mutations).includes("sk-or-sensitive"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.CONVEX_SECRET_ENCRYPTION_KEY;
    else process.env.CONVEX_SECRET_ENCRYPTION_KEY = originalKey;
  }
});
test("OpenRouter provider failures never return the response body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    "provider-body-with-fake-token sk-secret",
    { status: 401 },
  );
  try {
    await assert.rejects(
      (exchangeAndStore as any)._handler({
        auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
        runQuery: async () => null,
        runMutation: async () => true,
      }, { code: "one-time-code", codeVerifier: "a".repeat(64) }),
      (error: unknown) => !String(error).includes("sk-secret"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
