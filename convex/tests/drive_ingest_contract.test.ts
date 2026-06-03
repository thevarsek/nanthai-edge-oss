import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  attachmentTypeForMime,
  downloadDriveFileBytes,
  fetchDriveMetadata,
  ingestDriveFile,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "../drive_picker/ingest";
import { attachPickedDriveFiles, completeAfterResume } from "../drive_picker/actions";

function response(
  status: number,
  payload: unknown,
  opts: { arrayBuffer?: ArrayBuffer } = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    arrayBuffer: async () => opts.arrayBuffer ?? new TextEncoder().encode(String(payload)).buffer,
  } as any;
}

test("fetchDriveMetadata converts upstream failures to structured ConvexError", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => response(403, { error: "forbidden" })) as any;

  try {
    await assert.rejects(
      fetchDriveMetadata("token_1", "file_1"),
      (error) => {
        assert.ok(error instanceof ConvexError);
        assert.equal((error as ConvexError<any>).data.code, "UPSTREAM_ERROR");
        assert.match((error as ConvexError<any>).data.message, /metadata \(403\)/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("downloadDriveFileBytes exports Google Docs to text with a stable filename", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    requestedUrls.push(url);
    return response(200, {}, {
      arrayBuffer: new TextEncoder().encode("Exported text").buffer,
    });
  }) as any;

  try {
    const result = await downloadDriveFileBytes("token_1", {
      id: "doc_1",
      name: "Notes",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-05-11T10:00:00.000Z",
    });

    assert.equal(result.mimeType, "text/plain");
    assert.equal(result.filename, "Notes.txt");
    assert.equal(new TextDecoder().decode(result.bytes), "Exported text");
    assert.match(requestedUrls[0], /\/files\/doc_1\/export\?/);
    assert.match(requestedUrls[0], /mimeType=text%2Fplain/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ingestDriveFile reuses a fresh cached blob without downloading", async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];
  const mutations: Array<{ args: Record<string, unknown> }> = [];

  globalThis.fetch = (async (url: string) => {
    fetchCalls.push(url);
    return response(200, {
      id: "drive_1",
      name: "Cached.pdf",
      mimeType: "application/pdf",
      modifiedTime: "2026-05-11T10:00:00.000Z",
      size: "1000",
      webViewLink: "https://drive.google.com/file/d/drive_1/view",
    });
  }) as any;

  const ctx = {
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push({ args });
    },
    runQuery: async () => ({
      cachedStorageId: "storage_cached",
      cachedModifiedTime: "2026-05-11T10:00:00.000Z",
      cachedSizeBytes: 1000,
      name: "Cached.pdf",
      mimeType: "application/pdf",
    }),
    storage: {
      getUrl: async () => "https://storage.example/cached.pdf",
      store: async () => {
        throw new Error("fresh cache should not store a new blob");
      },
    },
  } as any;

  try {
    const result = await ingestDriveFile(ctx, "user_1", "token_1", "drive_1");

    assert.equal(result.storageId, "storage_cached");
    assert.equal(result.url, "https://storage.example/cached.pdf");
    assert.equal(result.type, "document");
    assert.equal(fetchCalls.length, 1, "only metadata should be fetched");
    assert.equal(mutations.length, 1, "grant metadata is still refreshed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ingestDriveFile rejects declared oversized files before download/storage", async () => {
  const originalFetch = globalThis.fetch;
  let storageCalled = false;

  globalThis.fetch = (async () => response(200, {
    id: "huge_1",
    name: "Huge.mov",
    mimeType: "video/mp4",
    modifiedTime: "2026-05-11T10:00:00.000Z",
    size: String(MAX_TOTAL_ATTACHMENT_BYTES + 1),
  })) as any;

  const ctx = {
    runMutation: async () => undefined,
    runQuery: async () => null,
    storage: {
      getUrl: async () => null,
      store: async () => {
        storageCalled = true;
        return "storage_1";
      },
    },
  } as any;

  try {
    await assert.rejects(
      ingestDriveFile(ctx, "user_1", "token_1", "huge_1"),
      (error) => {
        assert.ok(error instanceof ConvexError);
        assert.equal((error as ConvexError<any>).data.code, "DRIVE_FILE_TOO_LARGE");
        assert.equal((error as ConvexError<any>).data.filename, "Huge.mov");
        return true;
      },
    );
    assert.equal(storageCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("attachmentTypeForMime maps media and storage-backed documents", () => {
  assert.equal(attachmentTypeForMime("image/png"), "image");
  assert.equal(attachmentTypeForMime("audio/mpeg"), "audio");
  assert.equal(attachmentTypeForMime("video/mp4"), "video");
  assert.equal(attachmentTypeForMime("application/pdf"), "document");
  assert.equal(attachmentTypeForMime("text/csv"), "document");
});

test("attachPickedDriveFiles cancels awaiting batches when the picker returns no usable file ids", async () => {
  const mutations: Array<{ args: Record<string, unknown> }> = [];
  const result = await (attachPickedDriveFiles as any)._handler({
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    runQuery: async () => ({ status: "awaiting_pick" }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push({ args });
    },
  }, {
    batchId: "batch_1",
    fileIds: ["", "   "],
  });

  assert.deepEqual(result, { success: true, status: "cancelled" });
  assert.deepEqual(mutations[0].args, { batchId: "batch_1", userId: "user_1" });
});

test("attachPickedDriveFiles returns existing terminal batch status without touching Drive", async () => {
  const result = await (attachPickedDriveFiles as any)._handler({
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    runQuery: async () => ({ status: "completed" }),
    runMutation: async () => {
      throw new Error("terminal batches should not mutate");
    },
  }, {
    batchId: "batch_1",
    fileIds: ["drive_1"],
  });

  assert.deepEqual(result, { success: true, status: "completed" });
});

test("completeAfterResume delegates final status to the internal mutation", async () => {
  const calls: Array<Record<string, unknown>> = [];
  await (completeAfterResume as any)._handler({
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      calls.push(args);
    },
  }, {
    batchId: "batch_1",
    status: "failed",
  });

  assert.deepEqual(calls, [{ batchId: "batch_1", status: "failed" }]);
});

test("attachPickedDriveFiles ingests unique Drive files, persists provenance, and schedules resume", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, any>> = [];
  const scheduled: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (url: string) => {
    if (url.includes("?fields=")) {
      return response(200, {
        id: "drive_1",
        name: "Brief.pdf",
        mimeType: "application/pdf",
        modifiedTime: "2026-05-11T10:00:00.000Z",
        size: "12",
      });
    }
    return response(200, {}, {
      arrayBuffer: new TextEncoder().encode("PDF bytes").buffer,
    });
  }) as any;

  try {
    const result = await (attachPickedDriveFiles as any)._handler({
      auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
      runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
        if ("batchId" in args) return { status: "awaiting_pick" };
        if ("fileId" in args) return null;
        return {
          _id: "google_1",
          userId: "user_1",
          provider: "google",
          accessToken: "access_token",
          refreshToken: "refresh_token",
          expiresAt: Date.now() + 60 * 60 * 1000,
          scopes: ["https://www.googleapis.com/auth/drive.file"],
          status: "active",
          connectedAt: 1,
        };
      },
      runMutation: async (_ref: unknown, args: Record<string, any>) => {
        mutations.push(args);
        if ("attachments" in args) {
          return {
            chatId: "chat_1",
            userMessageId: "msg_user",
            assistantMessageIds: ["msg_assistant"],
            generationJobIds: ["job_1"],
            participant: { id: "participant_1", modelId: "openai/gpt-4.1-mini" },
            userId: "user_1",
            paramsSnapshot: { requestParams: { webSearchEnabled: true }, enabledIntegrations: ["google_drive"] },
          };
        }
        return null;
      },
      scheduler: {
        runAfter: async (_delayMs: number, _ref: unknown, args: Record<string, unknown>) => {
          scheduled.push(args);
          return "scheduled_1";
        },
      },
      storage: {
        store: async () => "storage_1",
        getUrl: async (id: string) => `https://storage.example/${id}`,
      },
    }, {
      batchId: "batch_1",
      fileIds: ["drive_1", "drive_1", " "],
    });

    assert.deepEqual(result, { success: true, status: "resuming", attachedCount: 1 });
    const append = mutations.find((entry) => "attachments" in entry)!;
    assert.deepEqual(append.pickedFileIds, ["drive_1"]);
    assert.equal(append.attachments[0].type, "document");
    assert.equal(append.attachments[0].driveFileId, "drive_1");
    assert.equal("fileId" in append.attachments[0], false);
    assert.equal(scheduled[0].webSearchEnabled, true);
    const scheduleResume = mutations.at(-1)!;
    assert.deepEqual(scheduleResume, { batchId: "batch_1", scheduledFunctionId: "scheduled_1" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
