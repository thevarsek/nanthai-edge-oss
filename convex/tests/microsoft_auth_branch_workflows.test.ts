import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";

import { decryptSecret, oauthSecretContext } from "../lib/secret_crypto";
import { getMicrosoftAccessToken, StoredMicrosoftConnection } from "../tools/microsoft/auth";

process.env.CONVEX_SECRET_ENCRYPTION_KEY = "microsoft-auth-test-key";
process.env.CONVEX_SECRET_ENCRYPTION_ACTIVE_KID = "k1";
process.env.CONVEX_SECRET_LEGACY_READ_MODE = "migrate";

function connection(overrides: Partial<StoredMicrosoftConnection> = {}): StoredMicrosoftConnection {
  return {
    _id: "ms_1" as StoredMicrosoftConnection["_id"],
    userId: "user_1",
    provider: "microsoft",
    accessToken: "stored_access",
    refreshToken: "stored_refresh",
    expiresAt: Date.now() + 60 * 60 * 1000,
    scopes: ["Mail.Read"],
    status: "active",
    connectedAt: 1,
    lastRefreshedAt: 0,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("getMicrosoftAccessToken returns active unexpired tokens without refreshing", async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return jsonResponse(200, {});
  }) as any;

  try {
    const result = await getMicrosoftAccessToken({
      runQuery: async () => connection({ accessToken: "valid_access" }),
      runMutation: async () => {
        throw new Error("refresh should not run");
      },
    } as any, "user_1");

    assert.equal(result.accessToken, "valid_access");
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getMicrosoftAccessToken rejects missing, inactive, and non-refreshable connections", async () => {
  await assert.rejects(
    () => getMicrosoftAccessToken({
      runQuery: async () => null,
    } as any, "user_1"),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "INTEGRATION_NOT_CONNECTED",
  );

  await assert.rejects(
    () => getMicrosoftAccessToken({
      runQuery: async () => connection({ status: "expired" }),
    } as any, "user_1"),
    /Microsoft connection is expired/,
  );

  await assert.rejects(
    () => getMicrosoftAccessToken({
      runQuery: async () => connection({ expiresAt: Date.now() - 1, refreshToken: "" }),
    } as any, "user_1"),
    /no refresh token available/,
  );
});

test("getMicrosoftAccessToken marks provider refresh failures as expired", async () => {
  const originalClientId = process.env.MICROSOFT_CLIENT_ID;
  const originalFetch = globalThis.fetch;
  process.env.MICROSOFT_CLIENT_ID = "client_1";
  const mutations: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async () => new Response("bad refresh", { status: 401 })) as any;

  try {
    await assert.rejects(
      () => getMicrosoftAccessToken({
        runQuery: async () => connection({ expiresAt: Date.now() - 1 }),
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          mutations.push(args);
        },
      } as any, "user_1"),
      /Microsoft token refresh failed \(HTTP 401\)/,
    );
    assert.deepEqual(mutations, [{
      userId: "user_1",
      expectedConnectionId: "ms_1",
      expectedLastRefreshedAt: 0,
      errorMessage: "Token refresh failed (HTTP 401)",
    }]);
  } finally {
    process.env.MICROSOFT_CLIENT_ID = originalClientId;
    globalThis.fetch = originalFetch;
  }
});

test("getMicrosoftAccessToken keeps the old refresh token when Microsoft does not rotate it", async () => {
  const originalClientId = process.env.MICROSOFT_CLIENT_ID;
  const originalFetch = globalThis.fetch;
  process.env.MICROSOFT_CLIENT_ID = "client_1";
  const mutations: Array<Record<string, unknown>> = [];
  const queryResults = [
    connection({ accessToken: "stale", expiresAt: Date.now() - 1 }),
    connection({ accessToken: "fresh", expiresAt: Date.now() + 60 * 60 * 1000 }),
  ];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const params = new URLSearchParams(String(init?.body));
    assert.equal(params.get("client_id"), "client_1");
    assert.equal(params.get("refresh_token"), "stored_refresh");
    return jsonResponse(200, {
      access_token: "fresh_from_provider",
      expires_in: 3600,
      token_type: "Bearer",
    });
  }) as any;

  try {
    const result = await getMicrosoftAccessToken({
      runQuery: async () => queryResults.shift() ?? null,
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    } as any, "user_1");

    assert.equal(result.accessToken, "fresh");
    assert.equal(
      await decryptSecret(
        String(mutations[0].encryptedRefreshToken),
        oauthSecretContext("user_1", "microsoft", "refreshToken"),
      ),
      "stored_refresh",
    );
  } finally {
    process.env.MICROSOFT_CLIENT_ID = originalClientId;
    globalThis.fetch = originalFetch;
  }
});

test("getMicrosoftAccessToken handles CAS-lost refreshes and bounded retry exhaustion", async () => {
  const originalClientId = process.env.MICROSOFT_CLIENT_ID;
  const originalFetch = globalThis.fetch;
  process.env.MICROSOFT_CLIENT_ID = "client_1";
  globalThis.fetch = (async () => jsonResponse(200, {
    access_token: "fresh_from_provider",
    expires_in: 3600,
    token_type: "Bearer",
  })) as any;

  try {
    const recentWinner = [
      connection({ accessToken: "stale", expiresAt: Date.now() - 1, lastRefreshedAt: 0 }),
      connection({ accessToken: "winner", expiresAt: Date.now() - 1, lastRefreshedAt: Date.now() }),
      connection({ accessToken: "winner", expiresAt: Date.now() - 1, lastRefreshedAt: Date.now() }),
    ];
    const winner = await getMicrosoftAccessToken({
      runQuery: async () => recentWinner.shift() ?? null,
      runMutation: async () => undefined,
    } as any, "user_1");
    assert.equal(winner.accessToken, "winner");

    await assert.rejects(
      () => getMicrosoftAccessToken({
        runQuery: async () => connection({
          accessToken: "still_stale",
          expiresAt: Date.now() - 1,
          lastRefreshedAt: 0,
        }),
        runMutation: async () => undefined,
      } as any, "user_1"),
      /Failed to refresh Microsoft token after multiple attempts/,
    );
  } finally {
    process.env.MICROSOFT_CLIENT_ID = originalClientId;
    globalThis.fetch = originalFetch;
  }
});
