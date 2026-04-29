import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  deleteConnection as deleteGoogleConnection,
  disconnectGoogle,
  exchangeGoogleCode,
  getDrivePickerAccessToken,
  markConnectionExpired as markGoogleConnectionExpired,
} from "../oauth/google";
import {
  disconnectMicrosoft,
  exchangeMicrosoftCode,
  markConnectionExpired as markMicrosoftConnectionExpired,
} from "../oauth/microsoft";
import {
  disconnectNotion,
  exchangeNotionCode,
  getNotionConnection,
  markConnectionExpired as markNotionConnectionExpired,
} from "../oauth/notion";
import {
  disconnectSlack,
  exchangeSlackCode,
  getSlackConnection,
  markConnectionExpired as markSlackConnectionExpired,
} from "../oauth/slack";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

test("exchangeGoogleCode uses the web client config and stores profile metadata", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const mutations: Record<string, unknown>[] = [];

  try {
    process.env.GOOGLE_CLIENT_ID = "native_client";
    process.env.GOOGLE_WEB_CLIENT_ID = "web_client";
    process.env.GOOGLE_WEB_CLIENT_SECRET = "web_secret";

    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      if (String(url).includes("/token")) {
        return {
          ok: true,
          json: async () => ({
            access_token: "access_google",
            refresh_token: "refresh_google",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "openid https://www.googleapis.com/auth/drive.file",
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ email: "user@example.com", name: "User Example" }),
      } as Response;
    }) as typeof fetch;

    const result = await (exchangeGoogleCode as any)._handler({
      auth: buildAuth(),
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    }, {
      code: "code_1",
      codeVerifier: "verifier_1",
      redirectUri: "https://nanthai.tech/oauth/google/callback",
      requestedIntegration: "drive",
    });

    const tokenBody = new URLSearchParams(String(requests[0]?.init?.body ?? ""));
    assert.deepEqual(result, { success: true, email: "user@example.com" });
    assert.equal(tokenBody.get("client_id"), "web_client");
    assert.equal(tokenBody.get("client_secret"), "web_secret");
    assert.equal(mutations[0]?.clientType, "web");
    assert.equal(mutations[0]?.email, "user@example.com");
    assert.equal(mutations[0]?.displayName, "User Example");
    assert.deepEqual(mutations[0]?.scopes, [
      "https://www.googleapis.com/auth/drive.file",
      "openid",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test("exchangeGoogleCode converts token exchange failures into ConvexError", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  try {
    process.env.GOOGLE_CLIENT_ID = "native_client";
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      text: async () => "nope",
    })) as unknown as typeof fetch;

    await assert.rejects(
      (exchangeGoogleCode as any)._handler({
        auth: buildAuth(),
        runMutation: async () => undefined,
      }, {
        code: "bad",
        codeVerifier: "bad",
        redirectUri: "com.googleusercontent.apps.example:/oauth/google/callback",
        requestedIntegration: "base",
      }),
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

test("exchangeGoogleCode rejects legacy Google Gmail requests", async () => {
  await assert.rejects(
    (exchangeGoogleCode as any)._handler({
      auth: buildAuth(),
      runMutation: async () => undefined,
    }, {
      code: "code_1",
      codeVerifier: "verifier_1",
      redirectUri: "https://nanthai.tech/oauth/google/callback",
      requestedIntegration: "gmail",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.code === "GMAIL_MANUAL_REQUIRED";
    },
  );
});

test("disconnectGoogle revokes the stored token and deleteConnection is idempotent", async () => {
  const originalFetch = globalThis.fetch;
  const fetches: string[] = [];
  const mutations: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];

  try {
    globalThis.fetch = (async (url: string | URL) => {
      fetches.push(String(url));
      return { ok: true } as Response;
    }) as typeof fetch;

    const result = await (disconnectGoogle as any)._handler({
      auth: buildAuth(),
      runQuery: async () => ({
        accessToken: "access_google",
        refreshToken: "refresh_google",
      }),
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    }, {});

    await (deleteGoogleConnection as any)._handler({
      db: {
        query: () => ({
          withIndex: () => ({
            unique: async () => null,
          }),
        }),
        delete: async (id: string) => {
          deleted.push(id);
        },
      },
    }, { userId: "user_1" });

    assert.deepEqual(result, { success: true });
    assert.match(fetches[0] ?? "", /token=refresh_google/);
    assert.deepEqual(mutations[0], { userId: "user_1" });
    assert.deepEqual(deleted, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getDrivePickerAccessToken refreshes expired Drive tokens before returning them", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const mutations: Record<string, unknown>[] = [];
  const queryResults = [
    {
      _id: "google_1",
      userId: "user_1",
      provider: "google",
      accessToken: "expired_picker_token",
      refreshToken: "refresh_google",
      expiresAt: Date.now() - 1,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
      clientType: "web",
      status: "active",
      connectedAt: 1,
      lastRefreshedAt: 0,
    },
    {
      _id: "google_1",
      userId: "user_1",
      provider: "google",
      accessToken: "fresh_picker_token",
      refreshToken: "refresh_google",
      expiresAt: Date.now() + 60 * 60 * 1000,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
      clientType: "web",
      status: "active",
      connectedAt: 1,
      lastRefreshedAt: Date.now(),
    },
  ];

  try {
    process.env.GOOGLE_WEB_CLIENT_ID = "web_client";
    process.env.GOOGLE_WEB_CLIENT_SECRET = "web_secret";
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      assert.equal(String(url), "https://oauth2.googleapis.com/token");
      const body = new URLSearchParams(String(init?.body ?? ""));
      assert.equal(body.get("client_id"), "web_client");
      assert.equal(body.get("client_secret"), "web_secret");
      assert.equal(body.get("refresh_token"), "refresh_google");
      return {
        ok: true,
        json: async () => ({
          access_token: "fresh_from_provider",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      } as Response;
    }) as typeof fetch;

    const result = await (getDrivePickerAccessToken as any)._handler({
      auth: buildAuth(),
      runQuery: async () => queryResults.shift() ?? null,
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    }, {});

    assert.equal(result.accessToken, "fresh_picker_token");
    assert.equal(mutations[0]?.accessToken, "fresh_from_provider");
    assert.equal(mutations[0]?.clientType, "web");
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test("exchangeMicrosoftCode requires config and disconnect helpers delete stored connections", async () => {
  const originalFetch = globalThis.fetch;
  const originalClientId = process.env.MICROSOFT_CLIENT_ID;
  const mutations: Record<string, unknown>[] = [];

  delete process.env.MICROSOFT_CLIENT_ID;
  await assert.rejects(
    (exchangeMicrosoftCode as any)._handler({
      auth: buildAuth(),
      runMutation: async () => undefined,
    }, {
      code: "code_1",
      codeVerifier: "verifier_1",
      redirectUri: "msauth://callback",
    }),
    /MICROSOFT_CLIENT_ID/,
  );

  try {
    process.env.MICROSOFT_CLIENT_ID = "ms_client";
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).includes("/token")) {
        return {
          ok: true,
          json: async () => ({
            access_token: "access_ms",
            refresh_token: "refresh_ms",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "Mail.Read",
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          userPrincipalName: "user@example.com",
          displayName: "MS User",
        }),
      } as Response;
    }) as typeof fetch;

    const exchange = await (exchangeMicrosoftCode as any)._handler({
      auth: buildAuth(),
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    }, {
      code: "code_1",
      codeVerifier: "verifier_1",
      redirectUri: "msauth://callback",
    });
    const disconnect = await (disconnectMicrosoft as any)._handler({
      auth: buildAuth(),
      runQuery: async () => ({ _id: "oauth_ms" }),
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    }, {});

    assert.deepEqual(exchange, { success: true, email: "user@example.com" });
    assert.equal(mutations[0]?.displayName, "MS User");
    assert.deepEqual(disconnect, { success: true });
    assert.deepEqual(mutations[1], { userId: "user_1" });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.MICROSOFT_CLIENT_ID = originalClientId;
  }
});

test("exchangeNotionCode persists workspace metadata and public query returns it", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const mutations: Record<string, unknown>[] = [];

  try {
    process.env.NOTION_CLIENT_ID = "notion_client";
    process.env.NOTION_CLIENT_SECRET = "notion_secret";
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      assert.match(String(init?.headers && (init.headers as Record<string, string>).Authorization), /^Basic /);
      return {
        ok: true,
        json: async () => ({
          access_token: "access_notion",
          bot_id: "bot_1",
          workspace_id: "workspace_1",
          workspace_name: "NanthAI",
          owner: {
            type: "user",
            user: {
              id: "user_notion",
              name: "Notion User",
              person: { email: "user@example.com" },
            },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const exchange = await (exchangeNotionCode as any)._handler({
      auth: buildAuth(),
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    }, {
      code: "code_1",
      redirectUri: "nanthai://oauth/notion",
    });
    const query = await (getNotionConnection as any)._handler({
      auth: buildAuth(),
      db: {
        query: () => ({
          withIndex: () => ({
            unique: async () => ({
              _id: "oauth_notion",
              userId: "user_1",
              provider: "notion",
              email: "user@example.com",
              displayName: "Notion User",
              workspaceId: "workspace_1",
              workspaceName: "NanthAI",
              scopes: [],
              status: "active",
              connectedAt: 1,
            }),
          }),
        }),
      },
    }, {});
    const disconnect = await (disconnectNotion as any)._handler({
      auth: buildAuth(),
      runQuery: async () => ({ _id: "oauth_notion" }),
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    }, {});

    assert.deepEqual(exchange, {
      success: true,
      email: "user@example.com",
      workspaceName: "NanthAI",
    });
    assert.equal(mutations[0]?.workspaceId, "workspace_1");
    assert.equal(query?.workspaceName, "NanthAI");
    assert.equal(query?.workspaceId, "workspace_1");
    assert.deepEqual(disconnect, { success: true });
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test("connection expiry helpers patch default error messages for each provider", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const db = {
    query: () => ({
      withIndex: () => ({
        unique: async () => ({ _id: "oauth_1" }),
      }),
    }),
    patch: async (_id: string, patch: Record<string, unknown>) => {
      patches.push(patch);
    },
  };

  await (markGoogleConnectionExpired as any)._handler({ db }, { userId: "user_1" });
  await (markMicrosoftConnectionExpired as any)._handler({ db }, { userId: "user_1" });
  await (markNotionConnectionExpired as any)._handler({ db }, { userId: "user_1" });
  await (markSlackConnectionExpired as any)._handler({ db }, { userId: "user_1" });

  assert.deepEqual(
    patches.map((patch) => patch.errorMessage),
    ["Token refresh failed", "Token refresh failed", "Token refresh failed", "Token refresh failed"],
  );
  assert.ok(patches.every((patch) => patch.status === "expired"));
});

test("exchangeSlackCode stores rotating user tokens and public query returns metadata", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const mutations: Record<string, unknown>[] = [];

  try {
    process.env.SLACK_CLIENT_ID = "slack_client";
    process.env.SLACK_CLIENT_SECRET = "slack_secret";
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).includes("oauth.v2.user.access")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            authed_user: {
              id: "U123",
              access_token: "xoxe.xoxp-access",
              refresh_token: "xoxe-refresh",
              expires_in: 43200,
              scope: "chat:write,search:read.public",
              token_type: "user",
            },
            team: {
              id: "T123",
              name: "NanthAI",
            },
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          ok: true,
          user_id: "U123",
          user: "Slack User",
          team_id: "T123",
          team: "NanthAI",
        }),
      } as Response;
    }) as typeof fetch;

    const exchange = await (exchangeSlackCode as any)._handler({
      auth: buildAuth(),
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    }, {
      code: "code_1",
      redirectUri: "https://nanthai.tech/oauth/slack/callback",
    });

    const query = await (getSlackConnection as any)._handler({
      auth: buildAuth(),
      db: {
        query: () => ({
          withIndex: () => ({
            unique: async () => ({
              _id: "oauth_slack",
              userId: "user_1",
              provider: "slack",
              displayName: "Slack User",
              workspaceId: "T123",
              workspaceName: "NanthAI",
              scopes: ["chat:write", "search:read.public"],
              status: "active",
              connectedAt: 1,
              expiresAt: Date.now() + 43_200_000,
              refreshToken: "xoxe-refresh",
            }),
          }),
        }),
      },
    }, {});

    const disconnect = await (disconnectSlack as any)._handler({
      auth: buildAuth(),
      runQuery: async () => ({ _id: "oauth_slack", accessToken: "xoxe.xoxp-access" }),
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    }, {});

    assert.deepEqual(exchange, {
      success: true,
      displayName: "Slack User",
      workspaceName: "NanthAI",
    });
    assert.equal(mutations[0]?.accessToken, "xoxe.xoxp-access");
    assert.equal(mutations[0]?.refreshToken, "xoxe-refresh");
    assert.deepEqual(mutations[0]?.scopes, ["chat:write", "search:read.public"]);
    assert.equal(query?.workspaceName, "NanthAI");
    assert.equal(query?.displayName, "Slack User");
    assert.deepEqual(disconnect, { success: true });
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});
