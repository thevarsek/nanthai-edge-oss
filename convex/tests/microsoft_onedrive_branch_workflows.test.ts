import test from "node:test";
import assert from "node:assert/strict";

import { onedriveList, onedriveMove, onedriveRead, onedriveUpload } from "../tools/microsoft/onedrive";

function response(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => typeof payload === "string" ? payload : JSON.stringify(payload),
    blob: async () => new Blob(["file-bytes"], { type: "text/plain" }),
  } as any;
}

function ctx(storageUrl = "https://cdn.example/file") {
  return {
    userId: "user_1",
    ctx: {
      runQuery: async () => ({
        _id: "ms_1",
        userId: "user_1",
        provider: "microsoft",
        accessToken: "ms_token",
        refreshToken: "refresh",
        expiresAt: Date.now() + 60 * 60_000,
        scopes: ["Files.ReadWrite"],
        status: "active",
        connectedAt: 1,
      }),
      runMutation: async () => undefined,
      storage: { getUrl: async () => storageUrl },
    },
  } as any;
}

test("onedriveUpload reports Graph upload failures and non-Error storage fetch failures", async () => {
  const originalFetch = globalThis.fetch;
  let mode: "upload-error" | "throw-string" = "upload-error";
  globalThis.fetch = (async (url: string) => {
    if (mode === "throw-string") throw "cdn exploded";
    if (url.startsWith("https://cdn.example/")) return response(200, {});
    if (url.includes("/drive/root:/Report.txt:/content")) {
      return response(507, "quota exceeded");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const graphFailure = await onedriveUpload.execute(ctx(), {
      storage_id: "storage_1",
      filename: "Report.txt",
      folder_path: "/",
    });
    mode = "throw-string";
    const thrown = await onedriveUpload.execute(ctx(), {
      storage_id: "storage_1",
      filename: "Report.txt",
    });

    assert.equal(graphFailure.success, false);
    assert.match(graphFailure.error ?? "", /OneDrive upload failed \(HTTP 507\): quota exceeded/);
    assert.equal(thrown.success, false);
    assert.equal(thrown.error, "cdn exploded");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onedriveList covers root empty results and non-Error failures", async () => {
  const originalFetch = globalThis.fetch;
  let throwString = false;
  globalThis.fetch = (async (url: string) => {
    if (throwString) throw "list exploded";
    assert.match(url, /\/drive\/root\/children\?/);
    return response(200, { value: [] });
  }) as any;

  try {
    const empty = await onedriveList.execute(ctx(), {});
    throwString = true;
    const thrown = await onedriveList.execute(ctx(), {});

    assert.equal(empty.success, true);
    assert.deepEqual((empty.data as any).files, []);
    assert.equal((empty.data as any).hasMore, false);
    assert.equal((empty.data as any).message, "No files found in OneDrive matching the criteria.");
    assert.equal(thrown.success, false);
    assert.equal(thrown.error, "list exploded");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onedriveRead handles download failures, small text reads, linked binary files, and thrown values", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (url.includes("throw_file")) throw "read exploded";
    if (url.includes("download_fail?")) {
      return response(200, {
        id: "download_fail",
        name: "notes.txt",
        size: 25,
        file: { mimeType: "text/plain" },
      });
    }
    if (url.includes("download_fail/content")) return response(403, "blocked");
    if (url.includes("small_text?")) {
      return response(200, {
        id: "small_text",
        name: "notes.sql",
        file: { mimeType: "application/sql" },
      });
    }
    if (url.includes("small_text/content")) {
      return { ok: true, status: 200, text: async () => "select 1;" } as any;
    }
    if (url.includes("binary_link?")) {
      return response(200, {
        id: "binary_link",
        name: "photo.png",
        webUrl: "https://onedrive/photo",
        file: { mimeType: "image/png" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const downloadFailure = await onedriveRead.execute(ctx(), { file_id: "download_fail" });
    const smallText = await onedriveRead.execute(ctx(), { file_id: "small_text" });
    const binary = await onedriveRead.execute(ctx(), { file_id: "binary_link" });
    const thrown = await onedriveRead.execute(ctx(), { file_id: "throw_file" });

    assert.equal(downloadFailure.success, false);
    assert.match(downloadFailure.error ?? "", /Failed to download file \(HTTP 403\): blocked/);
    assert.equal(smallText.success, true);
    assert.equal((smallText.data as any).content, "select 1;");
    assert.equal((smallText.data as any).truncated, false);
    assert.equal((smallText.data as any).message, 'Read "notes.sql" (9 characters).');
    assert.equal(binary.success, true);
    assert.match((binary.data as any).message, /\[Open in OneDrive\]/);
    assert.equal(thrown.success, false);
    assert.equal(thrown.error, "read exploded");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("onedriveMove supports folder IDs without links and reports thrown values", async () => {
  const originalFetch = globalThis.fetch;
  let throwString = false;
  const patchBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    if (throwString) throw "move exploded";
    patchBodies.push(JSON.parse(String(init.body)));
    return response(200, {
      id: "item_1",
      name: "Moved.txt",
      parentReference: { path: "/drive/root:/Projects" },
    });
  }) as any;

  try {
    const moved = await onedriveMove.execute(ctx(), {
      item_id: "item_1",
      destination_folder_id: "folder_1",
    });
    throwString = true;
    const thrown = await onedriveMove.execute(ctx(), {
      item_id: "item_1",
      destination_folder_path: "/Projects",
    });

    assert.equal(moved.success, true);
    assert.equal((moved.data as any).message, 'Moved "Moved.txt" to folder_1.');
    assert.deepEqual(patchBodies[0], { parentReference: { id: "folder_1" } });
    assert.equal(thrown.success, false);
    assert.equal(thrown.error, "move exploded");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
