import assert from "node:assert/strict";
import test from "node:test";

import { getAccountCapabilitiesPublic } from "../capabilities/queries";
import { get as getFolder, list as listFolders } from "../folders/queries";
import { get as getParticipant, listByChat } from "../participants/queries";
import { getDefault, get as getPersona, list as listPersonas } from "../personas/queries";
import { get, getKBFileContents, hasApiKey, list, listRuns } from "../scheduledJobs/queries";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId, email: "user@example.com" } : null),
  };
}

test("persona queries are auth-aware and resolve avatar URLs", async () => {
  const personas = [
    { _id: "persona_2", userId: "user_1", name: "Writer", avatarImageStorageId: "avatar_2", isDefault: true },
    { _id: "persona_1", userId: "user_1", name: "Analyst" },
  ];

  const listResult = await (listPersonas as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          collect: async () => personas,
        }),
      }),
    },
    storage: {
      getUrl: async (id: string) => `https://cdn.example/${id}`,
    },
  }, {});

  const defaultResult = await (getDefault as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => personas[0],
        }),
      }),
    },
    storage: {
      getUrl: async (id: string) => `https://cdn.example/${id}`,
    },
  }, {});

  const anonymous = await (listPersonas as any)._handler({
    auth: buildAuth(null),
    db: {},
  }, {});

  assert.equal(listResult[0]?.avatarImageUrl, "https://cdn.example/avatar_2");
  assert.equal(listResult[1]?.avatarImageUrl, undefined);
  assert.equal(defaultResult?.avatarImageUrl, "https://cdn.example/avatar_2");
  assert.deepEqual(anonymous, []);
});

test("persona get hides foreign records", async () => {
  const result = await (getPersona as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "persona_1", userId: "user_2" }),
    },
    storage: {
      getUrl: async () => null,
    },
  }, {
    personaId: "persona_1",
  });

  assert.equal(result, null);
});

test("participant queries sort by sortOrder and enforce ownership", async () => {
  const listResult = await (listByChat as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) => (id === "chat_1" ? { _id: "chat_1", userId: "user_1" } : null),
      query: () => ({
        withIndex: () => ({
          collect: async () => [
            { _id: "p2", sortOrder: 2 },
            { _id: "p1", sortOrder: 1 },
          ],
        }),
      }),
    },
  }, {
    chatId: "chat_1",
  });

  const foreign = await (getParticipant as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "participant_1", userId: "user_2" }),
    },
  }, {
    participantId: "participant_1",
  });

  assert.deepEqual(listResult.map((row: any) => row._id), ["p1", "p2"]);
  assert.equal(foreign, null);
});

test("folder queries preserve display ordering and ownership", async () => {
  const listResult = await (listFolders as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          collect: async () => [
            { _id: "folder_c", userId: "user_1", sortOrder: 2, createdAt: 1 },
            { _id: "folder_a", userId: "user_1", sortOrder: 1, createdAt: 3 },
            { _id: "folder_b", userId: "user_1", sortOrder: 1, createdAt: 2 },
          ],
        }),
      }),
    },
  }, {});

  const foreign = await (getFolder as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "folder_1", userId: "user_2" }),
    },
  }, {
    folderId: "folder_1",
  });

  assert.deepEqual(listResult.map((row: any) => row._id), ["folder_b", "folder_a", "folder_c"]);
  assert.equal(foreign, null);
});

test("capabilities public query returns computed account capability state", async () => {
  const result = await (getAccountCapabilitiesPublic as any)._handler({
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => (table === "purchaseEntitlements" ? { status: "active" } : null),
          collect: async () =>
            table === "userCapabilities"
              ? [
                  { capability: "mcpRuntime", status: "active", expiresAt: Date.now() + 1_000 },
                ]
              : [],
        }),
      }),
    },
  }, {});

  const anonymous = await (getAccountCapabilitiesPublic as any)._handler({
    auth: buildAuth(null),
    db: {},
  }, {});

  assert.deepEqual(result, {
    capabilities: ["pro", "mcpRuntime"],
    hasMcpRuntime: true,
    isPro: true,
  });
  assert.equal(anonymous, null);
});

test("scheduled job queries enforce ownership, clamp limits, and redact secret presence", async () => {
  const listRunsResult = await (listRuns as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "job_1", userId: "user_1" }),
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () => (table === "scheduledJobs" ? [{ _id: "job_1" }] : []),
          unique: async () => (table === "userSecrets" ? { _id: "secret_1", apiKey: "sk-key" } : null),
          order: () => ({
            take: async (limit: number) => {
              assert.equal(limit, 100);
              return [{ _id: "run_1" }, { _id: "run_2" }];
            },
          }),
        }),
      }),
    },
  }, {
    jobId: "job_1",
    limit: 999,
  });

  const hasKey = await (hasApiKey as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => ({ _id: "secret_1" }),
        }),
      }),
    },
  }, {});

  const getResult = await (get as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "job_1", userId: "user_1" }),
    },
  }, {
    jobId: "job_1",
  });

  const listResult = await (list as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          collect: async () => [{ _id: "job_1" }, { _id: "job_2" }],
        }),
      }),
    },
  }, {});

  assert.deepEqual(listRunsResult.map((row: any) => row._id), ["run_1", "run_2"]);
  assert.equal(hasKey, true);
  assert.equal(getResult?._id, "job_1");
  assert.deepEqual(listResult.map((row: any) => row._id), ["job_1", "job_2"]);
});

test("getKBFileContents fails when requested blobs are missing or unreadable", async () => {
  const blob = {
    text: async () => "hello world",
  };

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };

  try {
    await assert.rejects((getKBFileContents as any)._handler({
      // M24 Phase 6: action now resolves Drive-sourced storage ids through
      // the lazy-refresh chokepoint. For non-Drive ids the FA lookup returns
      // null and the original storageId is used unchanged.
      runQuery: async () => null,
      runAction: async () => {
        throw new Error("runAction should not be called for non-Drive ids");
      },
      storage: {
        get: async (storageId: string) => {
          if (storageId === "good") return blob;
          if (storageId === "bad") throw new Error("boom");
          return null;
        },
      },
    }, {
      storageIds: ["good", "missing", "bad"],
    }));

    assert.equal(await blob.text(), "hello world");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /missing/);
  } finally {
    console.warn = originalWarn;
  }
});

// ---------------------------------------------------------------------------
// M24 Phase 6 — getKBFileContents lazy Drive refresh chokepoint
// ---------------------------------------------------------------------------
//
// Drive-in-KB rows live in `fileAttachments` with `driveFileId` set. When a
// scheduled tool reads their contents we must:
//   1. resolve the FA row via `getFileAttachmentByStorageInternal`
//   2. call `refreshDriveStorageIfStale` (which may swap the storage id)
//   3. read bytes from the (possibly new) storage id
//
// Non-Drive rows (plain uploads, generatedFiles/generatedMedia rows that have
// no FA row at all) must skip both the FA query result and the refresh
// action — there's no upstream to refresh against.
//
// These tests pin the wire contract so a future refactor that reroutes the
// chokepoint surfaces here instead of as a silent "Drive file content went
// stale in production" bug.

test("getKBFileContents routes Drive-sourced ids through refreshDriveStorageIfStale", async () => {
  const blobs: Record<string, { text: () => Promise<string> }> = {
    storage_old: { text: async () => "stale bytes" },
    storage_fresh: { text: async () => "fresh bytes" },
  };

  const runQueryCalls: Array<{ args: any }> = [];
  const runActionCalls: Array<{ args: any }> = [];
  const warnings: Array<{ msg: string; err: unknown }> = [];
  const originalWarn = console.warn;
  console.warn = (msg?: unknown, err?: unknown) => {
    warnings.push({ msg: String(msg), err });
  };

  try {
    const fakeCtx = {
      runQuery: async (_ref: any, args: any) => {
        runQueryCalls.push({ args });
        if (args.storageId === "storage_old") {
          return {
            _id: "fa_drive_1",
            storageId: "storage_old",
            driveFileId: "drive_abc",
            userId: "user_1",
          };
        }
        return null;
      },
      runAction: async (_ref: any, args: any) => {
        runActionCalls.push({ args });
        assert.equal(args.fileAttachmentId, "fa_drive_1");
        return { storageId: "storage_fresh" };
      },
      storage: {
        get: async (storageId: string) => (
          storageId === "storage_plain_upload"
            ? { text: async () => "plain bytes" }
            : blobs[storageId] ?? null
        ),
      },
    };

    const result = await (getKBFileContents as any)._handler(fakeCtx, {
      storageIds: ["storage_old", "storage_plain_upload"],
    });

    assert.deepEqual(
      result,
      [
        { storageId: "storage_fresh", content: "fresh bytes" },
        { storageId: "storage_plain_upload", content: "plain bytes" },
      ],
      `runQuery calls: ${JSON.stringify(runQueryCalls)}; runAction calls: ${JSON.stringify(runActionCalls)}; warnings: ${JSON.stringify(warnings.map((w) => ({ msg: w.msg, err: w.err instanceof Error ? w.err.message : String(w.err) })))}`,
    );
    assert.equal(runQueryCalls.length, 2);
    assert.equal(runActionCalls.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test("getKBFileContents fails visibly on Drive refresh errors", async () => {
  // Explicitly selected KB context must not be silently omitted; a scheduled
  // job should fail instead of producing an answer without requested files.

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };

  try {
    const fakeCtx = {
      runQuery: async (_ref: any, args: any) => ({
        _id: args.storageId === "drive_a" ? "fa_a" : "fa_b",
        storageId: args.storageId,
        driveFileId: args.storageId === "drive_a" ? "drive_a_id" : "drive_b_id",
        userId: "user_1",
      }),
      runAction: async (_ref: any, args: any) => {
        if (args.fileAttachmentId === "fa_a") {
          // Mirror refreshDriveStorageIfStale strict behaviour: throw on
          // Drive HTTP failure rather than silently falling back.
          throw new Error("Drive 503 — service unavailable");
        }
        return { storageId: "storage_b_fresh" };
      },
      storage: {
        get: async (storageId: string) =>
          storageId === "storage_b_fresh"
            ? { text: async () => "b bytes" }
            : null,
      },
    };

    await assert.rejects((getKBFileContents as any)._handler(fakeCtx, {
      storageIds: ["drive_a", "drive_b"],
    }));

    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /drive_a/);
  } finally {
    console.warn = originalWarn;
  }
});
