import assert from "node:assert/strict";
import test from "node:test";

import { deleteAccount } from "../account/actions";
import { deleteUserTableBatch } from "../account/mutations";
import {
  getDriveFileGrantInternal,
  listDriveFileGrantsInternal,
  recordDriveFileGrant,
  recordDriveFileGrantCache,
  upsertConnection as upsertGoogleConnection,
  getGoogleConnection,
} from "../oauth/google";
import { ingestDriveFile } from "../drive_picker/ingest";
import type { ActionCtx } from "../_generated/server";
import { getMicrosoftConnection, upsertConnection as upsertMicrosoftConnection } from "../oauth/microsoft";
import { getNotionConnection } from "../oauth/notion";

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
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    expectedLastRefreshedAt: 10,
  });

  assert.equal(result, "oauth_google");
  assert.deepEqual(patches[0]?.patch.scopes, [
    "https://www.googleapis.com/auth/drive.file",
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
                "https://www.googleapis.com/auth/drive.file",
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
  assert.equal(google.hasGmail, false);
  assert.equal(google.hasDrive, true);
  assert.equal("refreshToken" in microsoft, false);
  assert.equal("accessToken" in notion, false);
});

test("google Drive file grants upsert by user and file and are user-scoped", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const storageDeletes: string[] = [];

  const existingGrant = {
    _id: "grant_1",
    userId: "user_1",
    fileId: "file_1",
    name: "Old name",
    mimeType: "text/plain",
    cachedStorageId: "storage_old",
  };

  await (recordDriveFileGrant as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => existingGrant,
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      insert: async (_table: string, value: Record<string, unknown>) => {
        inserts.push(value);
        return "grant_new";
      },
    },
  }, {
    userId: "user_1",
    fileId: "file_1",
    name: "New name",
    mimeType: "text/markdown",
    webViewLink: "https://drive.google.com/file/d/file_1/view",
    size: "42",
  });

  await (recordDriveFileGrantCache as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => existingGrant,
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
    storage: {
      delete: async (id: string) => {
        storageDeletes.push(id);
      },
    },
  }, {
    userId: "user_1",
    fileId: "file_1",
    name: "Cached name",
    mimeType: "application/pdf",
    webViewLink: "https://drive.google.com/file/d/file_1/view",
    size: "99",
    cachedStorageId: "storage_new",
    cachedModifiedTime: "2026-04-26T00:00:00.000Z",
    cachedSizeBytes: 99,
  });

  const grant = await (getDriveFileGrantInternal as any)._handler({
    db: {
      query: () => ({
        withIndex: (_indexName: string, builder: (q: { eq: (field: string, value: string) => unknown }) => unknown) => {
          const eqs: Array<[string, string]> = [];
          const q = { eq: (field: string, value: string) => { eqs.push([field, value]); return q; } };
          builder(q);
          return {
            unique: async () =>
              eqs.some(([field, value]) => field === "userId" && value === "user_1")
              && eqs.some(([field, value]) => field === "fileId" && value === "file_1")
                ? existingGrant
                : null,
          };
        },
      }),
    },
  }, { userId: "user_2", fileId: "file_1" });

  const listed = await (listDriveFileGrantsInternal as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          order: () => ({
            take: async () => [
              { ...existingGrant, name: "Quarterly Plan" },
              { _id: "grant_2", userId: "user_1", fileId: "file_2", name: "Budget" },
            ],
          }),
        }),
      }),
    },
  }, { userId: "user_1", maxResults: 500, query: "quarter" });

  assert.equal(patches[0]?.id, "grant_1");
  assert.equal(patches[0]?.value.name, "New name");
  assert.equal(patches[1]?.value.cachedStorageId, "storage_new");
  assert.deepEqual(storageDeletes, []);
  assert.equal(inserts.length, 0);
  assert.equal(grant, null);
  assert.equal(listed.totalGrantCount, 2);
  assert.equal(listed.matchedGrantCount, 1);
  assert.equal(listed.rows[0]?._id, "grant_1");
});

test("Drive ingestion reuses cache under the canonical Drive file id", async () => {
  const originalFetch = globalThis.fetch;
  const runQueryCalls: Array<{ userId: string; fileId: string }> = [];
  const runMutationCalls: Array<{ fileId: string }> = [];
  const storedBlobs: Blob[] = [];

  globalThis.fetch = (async (url: string) => {
    if (url.includes("/drive/v3/files/alias-file?fields=")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "canonical-file",
          name: "Report.txt",
          mimeType: "text/plain",
          modifiedTime: "2026-04-26T00:00:00.000Z",
          size: "42",
        }),
      } as any;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const fakeCtx = {
      runMutation: async (_ref: unknown, args: { fileId: string }) => {
        runMutationCalls.push(args);
      },
      runQuery: async (_ref: unknown, args: { userId: string; fileId: string }) => {
        runQueryCalls.push(args);
        if (args.fileId === "canonical-file") {
          return {
            fileId: "canonical-file",
            name: "Report.txt",
            mimeType: "text/plain",
            cachedStorageId: "storage_cached",
            cachedModifiedTime: "2026-04-26T00:00:00.000Z",
            cachedSizeBytes: 42,
          };
        }
        return null;
      },
      storage: {
        getUrl: async (storageId: string) =>
          storageId === "storage_cached" ? "https://cdn.example/storage_cached" : null,
        store: async (blob: Blob) => {
          storedBlobs.push(blob);
          return "storage_new";
        },
      },
    } as unknown as ActionCtx;

    const result = await ingestDriveFile(fakeCtx, "user_1", "google_token", "alias-file");

    assert.equal(result.fileId, "canonical-file");
    assert.equal(result.storageId, "storage_cached");
    assert.equal(storedBlobs.length, 0);
    assert.deepEqual(runQueryCalls.map((call) => call.fileId), ["canonical-file"]);
    assert.deepEqual(runMutationCalls.map((call) => call.fileId), ["canonical-file"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
