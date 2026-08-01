import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";

import {
  addDriveFileGrant,
  deleteDriveFileGrantsForUser,
  disconnectGoogle,
  exchangeGoogleCode,
  getGoogleConnection,
} from "../oauth/google";

process.env.CONVEX_SECRET_ENCRYPTION_KEY = "oauth-test-key";
process.env.CONVEX_SECRET_ENCRYPTION_ACTIVE_KID = "k1";
process.env.CONVEX_SECRET_LEGACY_READ_MODE = "migrate";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

function queryUnique(value: unknown) {
  return {
    withIndex: () => ({
      unique: async () => value,
    }),
  };
}

test("Google OAuth exchange rejects missing tokens and falls back when profile lookup fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const mutations: Record<string, unknown>[] = [];
  let scenario: "missingToken" | "profileFailure" = "missingToken";

  try {
    process.env.GOOGLE_CLIENT_ID = "native_client";
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).includes("/token")) {
        if (scenario === "missingToken") {
          return {
            ok: true,
            json: async () => ({ expires_in: 60, token_type: "Bearer", scope: "" }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({
            access_token: "access_calendar",
            expires_in: 60,
            token_type: "Bearer",
            scope: "",
          }),
        } as Response;
      }
      throw new Error("userinfo offline");
    }) as typeof fetch;

    await assert.rejects(
      (exchangeGoogleCode as any)._handler({
        auth: buildAuth(),
        runMutation: async () => undefined,
      }, {
        code: "code_missing",
        codeVerifier: "verifier",
        redirectUri: "com.googleusercontent.apps.example:/oauth/google/callback",
        requestedIntegration: "base",
      }),
      (error: unknown) => error instanceof ConvexError
        && (error as ConvexError<any>).data?.message === "Google did not return an access token.",
    );

    scenario = "profileFailure";
    const result = await (exchangeGoogleCode as any)._handler({
      auth: buildAuth(),
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    }, {
      code: "code_calendar",
      codeVerifier: "verifier",
      redirectUri: "com.googleusercontent.apps.example:/oauth/google/callback",
      requestedIntegration: "calendar",
    });

    assert.deepEqual(result, { success: true, email: null });
    assert.equal(mutations[0]?.encryptedRefreshToken, "");
    assert.match(String(mutations[0]?.encryptedAccessToken), /^enc:v2:k1:/);
    assert.equal(mutations[0]?.email, undefined);
    assert.equal(mutations[0]?.displayName, undefined);
    assert.deepEqual(mutations[0]?.scopes, [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "openid",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test("Google connection metadata is client-safe and Drive grant actions validate input", async () => {
  const connected = await (getGoogleConnection as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => queryUnique({
        _id: "google_1",
        status: "active",
        scopes: ["https://www.googleapis.com/auth/drive.file"],
        connectedAt: 100,
      }),
    },
  }, {});
  const missing = await (getGoogleConnection as any)._handler({
    auth: buildAuth(),
    db: { query: () => queryUnique(null) },
  }, {});

  assert.equal(connected.email, null);
  assert.equal(connected.displayName, null);
  assert.equal(connected.lastUsedAt, null);
  assert.equal(connected.errorMessage, null);
  assert.equal(connected.hasDrive, true);
  assert.equal(connected.hasCalendar, false);
  assert.equal(missing, null);

  await assert.rejects(
    (addDriveFileGrant as any)._handler({
      auth: buildAuth(),
    }, { fileId: "   " }),
    (error: unknown) => error instanceof ConvexError
      && (error as ConvexError<any>).data?.code === "VALIDATION",
  );
});

test("Google disconnect continues after revoke failure and reports missing connections", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Record<string, unknown>[] = [];

  try {
    globalThis.fetch = (async () => {
      throw new Error("revoke offline");
    }) as typeof fetch;

    await assert.rejects(
      (disconnectGoogle as any)._handler({
        auth: buildAuth(),
        runQuery: async () => null,
      }, {}),
      (error: unknown) => error instanceof ConvexError
        && (error as ConvexError<any>).data?.code === "NOT_FOUND",
    );

    const result = await (disconnectGoogle as any)._handler({
      auth: buildAuth(),
      runQuery: async () => ({ accessToken: "access_only", refreshToken: "" }),
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    }, {});

    assert.deepEqual(result, { success: true });
    assert.deepEqual(mutations, [{ userId: "user_1" }, { userId: "user_1" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Drive grant cleanup deletes orphaned cached blobs and keeps referenced caches", async () => {
  const deletedRows: string[] = [];
  const deletedStorage: string[] = [];
  const grants = [{
    _id: "grant_orphan",
    cachedStorageId: "storage_orphan",
  }, {
    _id: "grant_referenced",
    cachedStorageId: "storage_referenced",
  }, {
    _id: "grant_plain",
  }];

  const result = await (deleteDriveFileGrantsForUser as any)._handler({
    db: {
      query: (table: string) => ({
        withIndex: (_index: string, apply?: (q: any) => unknown) => {
          let storageId: string | undefined;
          const q = {
            eq: (_field: string, value: string) => {
              storageId = value;
              return q;
            },
          };
          apply?.(q);
          return {
            collect: async () => grants,
            first: async () => table === "fileAttachments" && storageId === "storage_referenced"
              ? { _id: "attachment_1", storageId }
              : null,
          };
        },
      }),
      delete: async (id: string) => {
        deletedRows.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        deletedStorage.push(id);
        throw new Error("already gone");
      },
    },
  }, { userId: "user_1" });

  assert.deepEqual(result, { deleted: 3 });
  assert.deepEqual(deletedStorage, ["storage_orphan"]);
  assert.deepEqual(deletedRows, ["grant_orphan", "grant_referenced", "grant_plain"]);
});
