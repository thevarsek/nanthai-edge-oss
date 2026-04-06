import assert from "node:assert/strict";
import test from "node:test";

import { deleteAccount } from "../account/actions";
import { deleteUserTableBatch } from "../account/mutations";
import { getGoogleConnection, upsertConnection as upsertGoogleConnection } from "../oauth/google";
import { getMicrosoftConnection, upsertConnection as upsertMicrosoftConnection } from "../oauth/microsoft";
import { getNotionConnection } from "../oauth/notion";
import { cleanupMarkedSessions } from "../runtime/actions";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

test("google upsertConnection merges scopes and preserves existing refresh token", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const result = await (upsertGoogleConnection as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => ({
            _id: "oauth_google",
            userId: "user_1",
            provider: "google",
            refreshToken: "refresh_old",
            scopes: ["openid"],
            lastRefreshedAt: 10,
          }),
        }),
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  }, {
    userId: "user_1",
    accessToken: "access_new",
    refreshToken: "",
    expiresAt: 123,
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    expectedLastRefreshedAt: 10,
  });

  assert.equal(result, "oauth_google");
  assert.deepEqual(patches[0]?.patch.scopes, [
    "https://www.googleapis.com/auth/gmail.modify",
    "openid",
  ]);
  assert.equal(patches[0]?.patch.refreshToken, undefined);
});

test("microsoft upsertConnection uses CAS guard to skip stale refresh writes", async () => {
  let patched = false;

  const result = await (upsertMicrosoftConnection as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => ({
            _id: "oauth_ms",
            userId: "user_1",
            provider: "microsoft",
            lastRefreshedAt: 50,
          }),
        }),
      }),
      patch: async () => {
        patched = true;
      },
    },
  }, {
    userId: "user_1",
    accessToken: "access_new",
    refreshToken: "refresh_new",
    expiresAt: 999,
    scopes: ["Mail.Read"],
    expectedLastRefreshedAt: 10,
  });

  assert.equal(result, "oauth_ms");
  assert.equal(patched, false);
});

test("public oauth queries return metadata without tokens", async () => {
  const db = {
    query: (table: string) => ({
      withIndex: () => ({
        unique: async () => {
          if (table === "oauthConnections") {
            return {
              _id: "oauth_1",
              userId: "user_1",
              provider: "google",
              accessToken: "secret_access",
              refreshToken: "secret_refresh",
              email: "user@example.com",
              displayName: "User",
              scopes: [
                "https://www.googleapis.com/auth/gmail.modify",
                "https://www.googleapis.com/auth/drive",
              ],
              status: "active",
              connectedAt: 1,
              lastUsedAt: 2,
              errorMessage: undefined,
            };
          }
          return null;
        },
      }),
    }),
  };

  const google = await (getGoogleConnection as any)._handler({
    auth: buildAuth(),
    db,
  }, {});
  const microsoft = await (getMicrosoftConnection as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => ({
            _id: "oauth_2",
            userId: "user_1",
            provider: "microsoft",
            accessToken: "secret_access",
            refreshToken: "secret_refresh",
            email: "user@example.com",
            displayName: "User",
            scopes: ["Mail.Read"],
            status: "active",
            connectedAt: 1,
          }),
        }),
      }),
    },
  }, {});
  const notion = await (getNotionConnection as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => ({
            _id: "oauth_3",
            userId: "user_1",
            provider: "notion",
            accessToken: "secret_access",
            refreshToken: "secret_refresh",
            email: "user@example.com",
            displayName: "User",
            scopes: [],
            status: "active",
            connectedAt: 1,
          }),
        }),
      }),
    },
  }, {});

  assert.equal("accessToken" in google, false);
  assert.equal(google.hasGmail, true);
  assert.equal(google.hasDrive, true);
  assert.equal("refreshToken" in microsoft, false);
  assert.equal("accessToken" in notion, false);
});

test("deleteAccount drains tables in batches until deleteUserTableBatch returns under the batch size", async () => {
  const calls: string[] = [];

  const result = await (deleteAccount as any)._handler({
    auth: buildAuth(),
    runMutation: async (_fnRef: unknown, args: { tableName: string }) => {
      calls.push(args.tableName);
      if (args.tableName === "favorites" && calls.filter((name) => name === "favorites").length === 1) {
        return { deleted: 200 };
      }
      if (args.tableName === "favorites") {
        return { deleted: 3 };
      }
      return { deleted: 0 };
    },
  }, {});

  assert.equal(result.totalDeleted, 203);
  assert.equal(calls.filter((name) => name === "favorites").length, 2);
});

test("deleteUserTableBatch cancels scheduled functions before deleting scheduled jobs", async () => {
  const cancelled: string[] = [];
  const deleted: string[] = [];

  const result = await (deleteUserTableBatch as any)._handler({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          take: async () =>
            table === "scheduledJobs"
              ? [
                  { _id: "job_1", scheduledFunctionId: "fn_1" },
                  { _id: "job_2" },
                ]
              : [],
        }),
      }),
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
    scheduler: {
      cancel: async (id: string) => {
        cancelled.push(id);
      },
    },
  }, {
    userId: "user_1",
    tableName: "scheduledJobs",
  });

  assert.equal(result.deleted, 2);
  assert.deepEqual(cancelled, ["fn_1"]);
  assert.deepEqual(deleted, ["job_1", "job_2"]);
});

test("cleanupMarkedSessions skips chats with active generations and tombstones eligible sessions", async () => {
  const mutations: Array<{ fn: unknown; args: Record<string, unknown> }> = [];

  await (cleanupMarkedSessions as any)._handler({
    runQuery: async (fnRef: unknown, args: Record<string, unknown>) => {
      if (Object.keys(args).length === 0) {
        return [
          {
            _id: "session_active",
            userId: "user_1",
            chatId: "chat_active",
            templateName: "nanthai-edge-runtime",
            templateVersion: "1",
            cwd: "/tmp",
            timeoutMs: 1000,
            internetEnabled: true,
            publicTrafficEnabled: false,
            failureCount: 0,
          },
          {
            _id: "session_cleanup",
            userId: "user_1",
            chatId: "chat_cleanup",
            providerSandboxId: "sandbox_1",
            templateName: "nanthai-edge-runtime",
            templateVersion: "1",
            cwd: "/tmp",
            timeoutMs: 1000,
            internetEnabled: true,
            publicTrafficEnabled: false,
            failureCount: 0,
          },
        ];
      }
      return args.chatId === "chat_active";
    },
    runMutation: async (fn: unknown, args: Record<string, unknown>) => {
      mutations.push({ fn, args });
    },
  }, {});

  assert.equal(mutations.length, 2);
  assert.equal(mutations[0]?.args.sessionId, "session_cleanup");
  assert.equal(mutations[0]?.args.status, "deleted");
  assert.equal(mutations[1]?.args.eventType, "sandbox_deleted");
});
