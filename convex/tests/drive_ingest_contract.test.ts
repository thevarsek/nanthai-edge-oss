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
    assert.equal(result.type, "pdf");
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

test("attachmentTypeForMime maps media, PDFs, and fallback documents", () => {
  assert.equal(attachmentTypeForMime("image/png"), "image");
  assert.equal(attachmentTypeForMime("audio/mpeg"), "audio");
  assert.equal(attachmentTypeForMime("video/mp4"), "video");
  assert.equal(attachmentTypeForMime("application/pdf"), "pdf");
  assert.equal(attachmentTypeForMime("text/csv"), "document");
});
