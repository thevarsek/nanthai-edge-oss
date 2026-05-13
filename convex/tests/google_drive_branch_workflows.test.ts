import assert from "node:assert/strict";
import test from "node:test";

import { driveList, driveMove, driveRead, driveUpload } from "../tools/google/drive";

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    blob: async () => new Blob(["file-bytes"], { type: "text/plain" }),
  } as any;
}

function googleConnection(scopes = ["https://www.googleapis.com/auth/drive.file"]) {
  return {
    _id: "google_1",
    userId: "user_1",
    provider: "google",
    accessToken: "google_token",
    refreshToken: "refresh_1",
    expiresAt: Date.now() + 60 * 60_000,
    scopes,
    status: "active",
    connectedAt: 1,
  };
}

function toolCtx(options: {
  scopes?: string[];
  grantResult?: unknown;
  grant?: unknown;
  queryThrows?: unknown;
  storageUrl?: string | null;
} = {}) {
  let queryCount = 0;
  return {
    userId: "user_1",
    ctx: {
      runQuery: async () => {
        queryCount += 1;
        if (queryCount === 1) return googleConnection(options.scopes);
        if (options.queryThrows !== undefined) throw options.queryThrows;
        if (options.grantResult !== undefined) return options.grantResult;
        if (options.grant !== undefined) return options.grant;
        return null;
      },
      runMutation: async () => undefined,
      storage: {
        getUrl: async () => options.storageUrl ?? "https://cdn.example/file",
      },
    },
  } as any;
}

test("google drive tools validate required identifiers before external calls", async () => {
  const upload = await driveUpload.execute(toolCtx(), { filename: "Report.txt" });
  assert.equal(upload.success, false);
  assert.match(String(upload.error), /storage_id/);

  const read = await driveRead.execute(toolCtx(), {});
  assert.equal(read.success, false);
  assert.match(String(read.error), /file_id/);

  const move = await driveMove.execute(toolCtx(), { file_id: "file_1" });
  assert.equal(move.success, false);
  assert.match(String(move.error), /destination_folder_id/);
});

test("google drive list opens picker for first-time grants and formats large sizes", async () => {
  const noGrants = await driveList.execute(toolCtx({
    grantResult: { rows: [], totalGrantCount: 0 },
  }), { query: "  ", max_results: 0 });
  assert.equal(noGrants.success, true);
  assert.equal((noGrants.data as any).requiresDrivePicker, true);
  assert.equal((noGrants.deferred as any).data.reason, "no_drive_file_grants");

  const listed = await driveList.execute(toolCtx({
    grantResult: {
      rows: [
        {
          fileId: "small",
          name: "small.txt",
          mimeType: "text/plain",
          size: "512",
          grantedAt: 1,
        },
        {
          fileId: "big",
          name: "big.mov",
          mimeType: "video/quicktime",
          size: String(2 * 1024 * 1024 * 1024),
          lastUsedAt: 1_700_000_000_000,
          grantedAt: 1,
        },
      ],
      totalGrantCount: 2,
      matchedGrantCount: 2,
    },
  }), {});
  assert.equal(listed.success, true);
  assert.deepEqual((listed.data as any).files.map((file: any) => file.size), ["512 B", "2.0 GB"]);

  const failed = await driveList.execute(toolCtx({ queryThrows: "drive index offline" }), {});
  assert.equal(failed.success, false);
  assert.match(String(failed.error), /drive index offline/);
});

test("google drive upload handles non-linked successes and capability failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (url === "https://cdn.example/file") return jsonResponse(200, {});
    if (url.includes("/upload/drive/v3/files")) {
      return jsonResponse(200, {
        id: "drive_1",
        name: "Archive.bin",
        mimeType: "application/octet-stream",
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const uploaded = await driveUpload.execute(toolCtx(), {
      storage_id: "storage_1",
      filename: "Archive.bin",
    });
    assert.equal(uploaded.success, true);
    assert.match(String((uploaded.data as any).message), /ID: drive_1/);

    const denied = await driveUpload.execute(toolCtx({ scopes: [] }), {
      storage_id: "storage_1",
      filename: "Archive.bin",
    });
    assert.equal(denied.success, false);
    assert.equal((denied.data as any).requiresGoogleCapability, true);
    assert.equal((denied.data as any).integrationId, "drive");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("google drive move reports metadata failures and omits links when Drive returns none", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (url.includes("file_broken") && url.includes("fields=id,name,parents")) {
      return { ...jsonResponse(404, { error: "missing" }), text: async () => "missing" } as any;
    }
    if (url.includes("file_ok") && url.includes("fields=id,name,parents")) {
      return jsonResponse(200, { id: "file_ok", name: "Move me" });
    }
    if (url.includes("file_ok?addParents=folder_2")) {
      return jsonResponse(200, { id: "file_ok", name: "Move me", parents: ["folder_2"] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const broken = await driveMove.execute(toolCtx({
      grant: { fileId: "file_broken", name: "Broken" },
    }), { file_id: "file_broken", destination_folder_id: "folder_2" });
    assert.equal(broken.success, false);
    assert.match(String(broken.error), /Failed to get file metadata/);

    const moved = await driveMove.execute(toolCtx({
      grant: { fileId: "file_ok", name: "Move me" },
    }), { file_id: "file_ok", destination_folder_id: "folder_2" });
    assert.equal(moved.success, true);
    assert.equal((moved.data as any).webViewLink, undefined);
    assert.doesNotMatch(String((moved.data as any).message), /Open in Drive/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
