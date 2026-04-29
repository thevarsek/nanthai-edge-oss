import assert from "node:assert/strict";
import test from "node:test";

import {
  assertGoogleCapabilityGranted,
  getGoogleAccessToken,
  googleCapabilityToolError,
  MissingGoogleCapabilityError,
} from "../tools/google/auth";
import { getMicrosoftAccessToken } from "../tools/microsoft/auth";
import { getNotionAccessToken } from "../tools/notion/auth";
import { getSlackAccessToken } from "../tools/slack/auth";
import { notionFetch, notionHeaders } from "../tools/notion/client";

function jsonResponse(status: number, payload: unknown, headers?: Record<string, string>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers?.[name.toLowerCase()] ?? headers?.[name] ?? null,
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as any;
}

function textResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => {
      throw new Error("invalid json");
    },
    text: async () => body,
  } as any;
}

test("google capability guards surface a tool-friendly reconnect error", () => {
  assert.doesNotThrow(() => {
    assertGoogleCapabilityGranted({
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
    }, "calendar");
  });

  let thrown: unknown;
  try {
    assertGoogleCapabilityGranted({ scopes: [] }, "drive");
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown instanceof MissingGoogleCapabilityError, true);
  assert.deepEqual(googleCapabilityToolError(thrown), {
    success: false,
    data: {
      requiresGoogleCapability: true,
      integrationId: "drive",
    },
    error: "Google drive access is not granted. Ask the user to enable drive and complete Google consent.",
  });
  assert.equal(googleCapabilityToolError(new Error("other")), null);
});

test("getGoogleAccessToken returns a still-valid token without refreshing", async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("should not fetch");
  }) as any;

  try {
    const result = await getGoogleAccessToken({
      runQuery: async () => ({
        _id: "google_1",
        userId: "user_1",
        provider: "google",
        accessToken: "still_valid",
        refreshToken: "refresh_1",
        expiresAt: Date.now() + 60 * 60 * 1000,
        scopes: ["https://www.googleapis.com/auth/calendar.events"],
        status: "active",
        connectedAt: 1,
      }),
      runMutation: async () => {
        throw new Error("should not mutate");
      },
    } as any, "user_1", "calendar");

    assert.equal(result.accessToken, "still_valid");
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getGoogleAccessToken refreshes expired tokens and persists the refreshed values", async () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  const originalFetch = globalThis.fetch;
  process.env.GOOGLE_CLIENT_ID = "google_client";

  const queryResults = [
    {
      _id: "google_1",
      userId: "user_1",
      provider: "google",
      accessToken: "stale_token",
      refreshToken: "refresh_1",
      expiresAt: Date.now() - 1,
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
      email: "user@example.com",
      displayName: "User",
      clientType: "native",
      status: "active",
      connectedAt: 1,
      lastRefreshedAt: 0,
    },
    {
      _id: "google_1",
      userId: "user_1",
      provider: "google",
      accessToken: "fresh_from_db",
      refreshToken: "refresh_1",
      expiresAt: Date.now() + 60 * 60 * 1000,
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
      email: "user@example.com",
      displayName: "User",
      clientType: "native",
      status: "active",
      connectedAt: 1,
      lastRefreshedAt: Date.now(),
    },
  ];
  const mutations: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    assert.equal(init?.method, "POST");
    const params = new URLSearchParams(String(init?.body));
    assert.equal(params.get("client_id"), "google_client");
    assert.equal(params.get("grant_type"), "refresh_token");
    assert.equal(params.get("refresh_token"), "refresh_1");
    return jsonResponse(200, {
      access_token: "fresh_from_provider",
      expires_in: 3600,
      token_type: "Bearer",
    });
  }) as any;

  try {
    const result = await getGoogleAccessToken({
      runQuery: async () => queryResults.shift() ?? null,
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    } as any, "user_1", "calendar");

    assert.equal(result.accessToken, "fresh_from_db");
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0]?.userId, "user_1");
    assert.equal(mutations[0]?.accessToken, "fresh_from_provider");
    assert.equal(mutations[0]?.refreshToken, "refresh_1");
    assert.equal(mutations[0]?.clientType, "native");
  } finally {
    process.env.GOOGLE_CLIENT_ID = originalClientId;
    globalThis.fetch = originalFetch;
  }
});

test("getGoogleAccessToken marks the connection expired when the refresh request fails", async () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  const originalFetch = globalThis.fetch;
  process.env.GOOGLE_CLIENT_ID = "google_client";

  const mutations: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async () => textResponse(401, "invalid_grant")) as any;

  try {
    await assert.rejects(
      () =>
        getGoogleAccessToken({
          runQuery: async () => ({
            _id: "google_1",
            userId: "user_1",
            provider: "google",
            accessToken: "stale_token",
            refreshToken: "refresh_1",
            expiresAt: Date.now() - 1,
            scopes: ["https://www.googleapis.com/auth/calendar.events"],
            status: "active",
            connectedAt: 1,
            lastRefreshedAt: 0,
          }),
          runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
            mutations.push(args);
          },
        } as any, "user_1", "calendar"),
      /Google token refresh failed \(HTTP 401\)/,
    );

    assert.deepEqual(mutations, [{
      userId: "user_1",
      errorMessage: "Token refresh failed (HTTP 401)",
    }]);
  } finally {
    process.env.GOOGLE_CLIENT_ID = originalClientId;
    globalThis.fetch = originalFetch;
  }
});

test("getMicrosoftAccessToken refreshes expired tokens and stores rotated refresh tokens", async () => {
  const originalClientId = process.env.MICROSOFT_CLIENT_ID;
  const originalFetch = globalThis.fetch;
  process.env.MICROSOFT_CLIENT_ID = "microsoft_client";

  const queryResults = [
    {
      _id: "ms_1",
      userId: "user_1",
      provider: "microsoft",
      accessToken: "stale_token",
      refreshToken: "refresh_1",
      expiresAt: Date.now() - 1,
      scopes: ["mail.read"],
      email: "user@example.com",
      displayName: "User",
      status: "active",
      connectedAt: 1,
      lastRefreshedAt: 0,
    },
    {
      _id: "ms_1",
      userId: "user_1",
      provider: "microsoft",
      accessToken: "fresh_from_db",
      refreshToken: "refresh_2",
      expiresAt: Date.now() + 60 * 60 * 1000,
      scopes: ["mail.read"],
      email: "user@example.com",
      displayName: "User",
      status: "active",
      connectedAt: 1,
      lastRefreshedAt: Date.now(),
    },
  ];
  const mutations: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    assert.equal(
      url,
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    );
    const params = new URLSearchParams(String(init?.body));
    assert.equal(params.get("client_id"), "microsoft_client");
    assert.equal(params.get("refresh_token"), "refresh_1");
    return jsonResponse(200, {
      access_token: "fresh_from_provider",
      refresh_token: "refresh_2",
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

    assert.equal(result.accessToken, "fresh_from_db");
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0]?.refreshToken, "refresh_2");
    assert.equal(mutations[0]?.accessToken, "fresh_from_provider");
  } finally {
    process.env.MICROSOFT_CLIENT_ID = originalClientId;
    globalThis.fetch = originalFetch;
  }
});

test("getMicrosoftAccessToken throws when the client id is not configured", async () => {
  const originalClientId = process.env.MICROSOFT_CLIENT_ID;
  delete process.env.MICROSOFT_CLIENT_ID;

  try {
    await assert.rejects(
      () =>
        getMicrosoftAccessToken({
          runQuery: async () => ({
            _id: "ms_1",
            userId: "user_1",
            provider: "microsoft",
            accessToken: "stale_token",
            refreshToken: "refresh_1",
            expiresAt: Date.now() - 1,
            scopes: ["mail.read"],
            status: "active",
            connectedAt: 1,
            lastRefreshedAt: 0,
          }),
          runMutation: async () => undefined,
        } as any, "user_1"),
      /MICROSOFT_CLIENT_ID environment variable not set/,
    );
  } finally {
    process.env.MICROSOFT_CLIENT_ID = originalClientId;
  }
});

test("getNotionAccessToken returns the stored token and rejects inactive connections", async () => {
  const active = await getNotionAccessToken({
    runQuery: async () => ({
      _id: "notion_1",
      userId: "user_1",
      provider: "notion",
      accessToken: "notion_token",
      refreshToken: "",
      expiresAt: 0,
      scopes: [],
      status: "active",
      connectedAt: 1,
    }),
  } as any, "user_1");

  assert.equal(active.accessToken, "notion_token");

  await assert.rejects(
    () =>
      getNotionAccessToken({
        runQuery: async () => ({
          _id: "notion_1",
          userId: "user_1",
          provider: "notion",
          accessToken: "notion_token",
          refreshToken: "",
          expiresAt: 0,
          scopes: [],
          status: "expired",
          connectedAt: 1,
        }),
      } as any, "user_1"),
    /Notion connection is expired/,
  );
});

test("getSlackAccessToken refreshes rotated user tokens and stores the new refresh token", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  process.env.SLACK_CLIENT_ID = "slack_client";
  process.env.SLACK_CLIENT_SECRET = "slack_secret";

  const queryResults = [
    {
      _id: "slack_1",
      userId: "user_1",
      provider: "slack",
      accessToken: "stale_token",
      refreshToken: "refresh_1",
      expiresAt: Date.now() - 1,
      scopes: ["chat:write"],
      displayName: "Slack User",
      workspaceId: "T123",
      workspaceName: "NanthAI",
      status: "active",
      connectedAt: 1,
      lastRefreshedAt: 0,
    },
    {
      _id: "slack_1",
      userId: "user_1",
      provider: "slack",
      accessToken: "fresh_from_db",
      refreshToken: "refresh_2",
      expiresAt: Date.now() + 60 * 60 * 1000,
      scopes: ["chat:write", "search:read.public"],
      displayName: "Slack User",
      workspaceId: "T123",
      workspaceName: "NanthAI",
      status: "active",
      connectedAt: 1,
      lastRefreshedAt: Date.now(),
    },
  ];
  const mutations: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    assert.equal(url, "https://slack.com/api/oauth.v2.access");
    const params = new URLSearchParams(String(init?.body));
    assert.equal(params.get("client_id"), "slack_client");
    assert.equal(params.get("refresh_token"), "refresh_1");
    assert.equal(params.get("grant_type"), "refresh_token");
    return jsonResponse(200, {
      ok: true,
      authed_user: {
        access_token: "fresh_from_provider",
        refresh_token: "refresh_2",
        expires_in: 43200,
        scope: "chat:write,search:read.public",
      },
    });
  }) as any;

  try {
    const result = await getSlackAccessToken({
      runQuery: async () => queryResults.shift() ?? null,
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    } as any, "user_1");

    assert.equal(result.accessToken, "fresh_from_db");
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0]?.refreshToken, "refresh_2");
    assert.equal(mutations[0]?.accessToken, "fresh_from_provider");
    assert.deepEqual(mutations[0]?.scopes, ["chat:write", "search:read.public"]);
    assert.equal(mutations[0]?.expectedLastRefreshedAt, 0, "OCC guard must forward lastRefreshedAt from the stale connection");
  } finally {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  }
});

test("notionFetch applies Notion headers and retries rate-limited responses", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;

  const recordedSleeps: number[] = [];
  const releases: Array<Record<string, unknown>> = [];
  let fetchCalls = 0;

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number) => {
    recordedSleeps.push(Number(ms ?? 0));
    callback();
    return 0 as any;
  }) as any;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    fetchCalls += 1;
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer notion_token");
    if (fetchCalls === 1) {
      return jsonResponse(429, { object: "error" }, { "retry-after": "0.8" });
    }
    return jsonResponse(200, { ok: true });
  }) as any;

  try {
    const response = await notionFetch(
      {
        userId: "user_1",
        ctx: {
          runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
            if ("leaseMs" in args) {
              return { granted: true, waitMs: 0 };
            }
            releases.push(args);
            return undefined;
          },
        },
      } as any,
      "/search",
      "notion_token",
      { method: "POST", body: JSON.stringify({ query: "roadmap" }) },
    );

    assert.equal(response.status, 200);
    assert.equal(fetchCalls, 2);
    assert.deepEqual(recordedSleeps, [800]);
    assert.equal(releases.length, 2);
    assert.equal(releases[0]?.lastResponseStatus, 429);
    assert.equal(releases[1]?.lastResponseStatus, 200);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("notionFetch retries transport failures with backoff and exposes canonical headers", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;

  const recordedSleeps: number[] = [];
  const releases: Array<Record<string, unknown>> = [];
  let fetchCalls = 0;

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number) => {
    recordedSleeps.push(Number(ms ?? 0));
    callback();
    return 0 as any;
  }) as any;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      throw new Error("socket hang up");
    }
    return jsonResponse(200, { ok: true });
  }) as any;

  try {
    const response = await notionFetch(
      {
        userId: "user_1",
        ctx: {
          runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
            if ("leaseMs" in args) {
              return { granted: true, waitMs: 0 };
            }
            releases.push(args);
            return undefined;
          },
        },
      } as any,
      "https://api.notion.com/v1/pages",
      "notion_token",
    );

    assert.equal(response.status, 200);
    assert.deepEqual(recordedSleeps, [400]);
    assert.equal(releases[0]?.lastResponseStatus, undefined);
    assert.deepEqual(notionHeaders("notion_token"), {
      Authorization: "Bearer notion_token",
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
      Accept: "application/json",
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});
