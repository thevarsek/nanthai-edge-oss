import assert from "node:assert/strict";
import test from "node:test";

process.env.CONVEX_SECRET_ENCRYPTION_KEY ??= "test-auth-encryption-key";

import { ConvexError } from "convex/values";
import {
  extractFirstStreamingTextFromUnknown,
  extractFirstTextFromUnknown,
  extractImageUrlsFromUnknown,
  normalizeImageUrl,
  usageFromUnknown,
} from "../lib/openrouter_extract";
import { getSlackAccessToken } from "../tools/slack/auth";

test("OpenRouter extraction covers empty, primitive, and streaming-first edge cases", () => {
  assert.equal(normalizeImageUrl("   "), "");
  assert.deepEqual(extractImageUrlsFromUnknown(0), []);
  assert.deepEqual(extractImageUrlsFromUnknown({ image_url: { data: "x".repeat(70) } })[0]?.startsWith("data:image/png"), true);
  assert.equal(usageFromUnknown({
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    prompt_tokens_details: { cached_tokens: 0, audio_tokens: "bad" },
    completion_tokens_details: { reasoning_tokens: 0 },
    cost_details: { upstream_inference_cost: 0 },
    server_tool_use: { web_search_requests: 0 },
  })?.totalTokens, 0);

  assert.equal(extractFirstTextFromUnknown(42), undefined);
  assert.equal(extractFirstTextFromUnknown({ text: " direct " }), "direct");
  assert.equal(extractFirstTextFromUnknown({ other: "none" }), undefined);
  assert.equal(extractFirstTextFromUnknown([1, 2, { data: "deep" }]), "deep");

  assert.equal(extractFirstStreamingTextFromUnknown("  keep spaces  "), "  keep spaces  ");
  assert.equal(extractFirstStreamingTextFromUnknown(["", { delta: { content: "stream" } }]), "stream");
  assert.equal(extractFirstStreamingTextFromUnknown({ text: " raw " }), " raw ");
  assert.equal(extractFirstStreamingTextFromUnknown({ other: true }), undefined);
  assert.equal(extractFirstStreamingTextFromUnknown(null), undefined);
});

test("Slack auth returns valid tokens, handles disconnected states, and refreshes rotated tokens", async () => {
  await assert.rejects(
    getSlackAccessToken({ runQuery: async () => null } as any, "user_1"),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "INTEGRATION_NOT_CONNECTED",
  );

  await assert.rejects(
    getSlackAccessToken({
      runQuery: async () => ({ status: "expired" }),
    } as any, "user_1"),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "INTEGRATION_NOT_CONNECTED",
  );

  const valid = await getSlackAccessToken({
    runQuery: async () => ({
      _id: "slack_1",
      userId: "user_1",
      provider: "slack",
      accessToken: "xoxp-valid",
      refreshToken: "refresh",
      expiresAt: Date.now() + 60 * 60 * 1000,
      scopes: ["chat:write"],
      status: "active",
      connectedAt: 1,
    }),
  } as any, "user_1");
  assert.equal(valid.accessToken, "xoxp-valid");

  const recent = await getSlackAccessToken({
    runQuery: async () => ({
      _id: "slack_1",
      userId: "user_1",
      provider: "slack",
      accessToken: "xoxp-recent",
      refreshToken: "refresh",
      expiresAt: Date.now() + 1000,
      scopes: ["chat:write"],
      status: "active",
      connectedAt: 1,
      lastRefreshedAt: Date.now(),
    }),
  } as any, "user_1");
  assert.equal(recent.accessToken, "xoxp-recent");

  const originalClientId = process.env.SLACK_CLIENT_ID;
  const originalClientSecret = process.env.SLACK_CLIENT_SECRET;
  const originalFetch = globalThis.fetch;
  process.env.SLACK_CLIENT_ID = "client";
  process.env.SLACK_CLIENT_SECRET = "secret";
  const mutations: Array<Record<string, unknown>> = [];
  const queryResults = [
    {
      _id: "slack_1",
      userId: "user_1",
      provider: "slack",
      accessToken: "xoxp-old",
      refreshToken: "refresh-old",
      expiresAt: Date.now() + 1000,
      scopes: ["chat:write"],
      status: "active",
      connectedAt: 1,
      lastRefreshedAt: 0,
      displayName: "Ada",
      workspaceId: "T1",
      workspaceName: "Workspace",
    },
    {
      _id: "slack_1",
      userId: "user_1",
      provider: "slack",
      accessToken: "xoxp-new-db",
      refreshToken: "refresh-new",
      expiresAt: Date.now() + 60 * 60 * 1000,
      scopes: ["chat:write"],
      status: "active",
      connectedAt: 1,
    },
  ];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify({
      ok: true,
      authed_user: {
        access_token: "xoxp-new",
        refresh_token: "refresh-new",
        expires_in: 3600,
        scope: "chat:write,channels:read",
      },
    }), { status: 200 });
  }) as any;

  try {
    const refreshed = await getSlackAccessToken({
      runQuery: async () => queryResults.shift() ?? null,
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => mutations.push(args),
    } as any, "user_1");
    assert.equal(refreshed.accessToken, "xoxp-new-db");
    assert.deepEqual(mutations[0]?.scopes, ["chat:write", "channels:read"]);
  } finally {
    process.env.SLACK_CLIENT_ID = originalClientId;
    process.env.SLACK_CLIENT_SECRET = originalClientSecret;
    globalThis.fetch = originalFetch;
  }
});

test("Slack auth marks connections expired when refresh fails or config is missing", async () => {
  const originalClientId = process.env.SLACK_CLIENT_ID;
  const originalClientSecret = process.env.SLACK_CLIENT_SECRET;
  const originalFetch = globalThis.fetch;
  delete process.env.SLACK_CLIENT_ID;
  delete process.env.SLACK_CLIENT_SECRET;

  const expiredConnection = {
    _id: "slack_1",
    userId: "user_1",
    provider: "slack",
    accessToken: "xoxp-old",
    refreshToken: "refresh-old",
    expiresAt: Date.now() + 1000,
    scopes: [],
    status: "active",
    connectedAt: 1,
    lastRefreshedAt: 0,
  };

  await assert.rejects(
    getSlackAccessToken({ runQuery: async () => expiredConnection } as any, "user_1"),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "MISSING_CONFIG",
  );

  process.env.SLACK_CLIENT_ID = "client";
  process.env.SLACK_CLIENT_SECRET = "secret";
  const mutations: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error: "invalid_refresh_token" }), { status: 200 })) as any;

  try {
    await assert.rejects(
      getSlackAccessToken({
        runQuery: async () => expiredConnection,
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => mutations.push(args),
      } as any, "user_1"),
      (error: unknown) => error instanceof ConvexError && error.data?.code === "TOKEN_REFRESH_FAILED",
    );
    assert.equal(mutations[0]?.errorMessage, "Token refresh failed");
  } finally {
    process.env.SLACK_CLIENT_ID = originalClientId;
    process.env.SLACK_CLIENT_SECRET = originalClientSecret;
    globalThis.fetch = originalFetch;
  }
});
