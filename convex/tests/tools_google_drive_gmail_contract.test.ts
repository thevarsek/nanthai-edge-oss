import assert from "node:assert/strict";
import test from "node:test";

import { driveList, driveMove, driveRead, driveUpload } from "../tools/google/drive";
import { gmailCreateDraft, gmailRead, gmailSend } from "../tools/google/gmail";

function jsonResponse(status: number, payload: unknown, headers?: Record<string, string>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    headers: {
      get: (name: string) => headers?.[name.toLowerCase()] ?? headers?.[name] ?? null,
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    blob: async () => new Blob(["file-bytes"], { type: "text/plain" }),
    arrayBuffer: async () => new TextEncoder().encode("file-bytes").buffer,
    body: { cancel: async () => undefined },
  } as any;
}

function createGoogleToolCtx() {
  return {
    userId: "user_1",
    ctx: {
      runQuery: async (_reference?: unknown, args?: Record<string, unknown>) => {
        if (Array.isArray(args?.storageIds)) {
          const ownedIds = new Set(["storage_1", "missing_storage"]);
          return args.storageIds
            .filter((storageId): storageId is string =>
              typeof storageId === "string" && ownedIds.has(storageId)
            )
            .map((storageId) => ({ storageId }));
        }
        return {
        _id: "google_1",
        userId: "user_1",
        provider: "google",
        accessToken: "google_token",
        refreshToken: "refresh_1",
        expiresAt: Date.now() + 60 * 60 * 1000,
        scopes: [
          "https://www.googleapis.com/auth/drive.file",
        ],
        email: "owner@example.com",
        status: "active",
        connectedAt: 1,
        };
      },
      runMutation: async () => undefined,
      storage: {
        getUrl: async (storageId: string) =>
          storageId === "storage_1" ? "https://cdn.example/storage_1" : null,
        getMetadata: async (storageId: string) =>
          storageId === "storage_1" ? { size: 10 } : null,
      },
    },
  } as any;
}

test("google drive tools upload files and surface upstream failures", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (url === "https://cdn.example/storage_1") {
      return jsonResponse(200, {});
    }
    if (url.includes("/upload/drive/v3/files")) {
      return jsonResponse(200, {
        id: "drive_1",
        name: "Report.txt",
        mimeType: "text/plain",
        webViewLink: "https://drive.google.com/file/d/drive_1/view",
      });
    }
    if (url.includes("/drive/v3/files?")) {
      return jsonResponse(403, { error: "denied" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const uploaded = await driveUpload.execute(createGoogleToolCtx(), {
      storage_id: "storage_1",
      filename: "generated-image.webp",
    });
    let listQueryCount = 0;
    const listed = await driveList.execute({
      ...createGoogleToolCtx(),
      ctx: {
        ...createGoogleToolCtx().ctx,
        runQuery: async () => {
          listQueryCount += 1;
          if (listQueryCount === 1) return createGoogleToolCtx().ctx.runQuery();
          return {
            rows: [
              {
                fileId: "drive_1",
                name: "Report.txt",
                mimeType: "text/plain",
                webViewLink: "https://drive.google.com/file/d/drive_1/view",
                grantedAt: 1,
              },
            ],
            totalGrantCount: 1,
            matchedGrantCount: 1,
          };
        },
      },
    } as any, {
      query: "name contains 'report'",
      max_results: 99,
    });

    assert.equal(uploaded.success, true);
    assert.equal((uploaded.data as any).fileId, "drive_1");
    assert.match(String((uploaded.data as any).message), /Open in Drive/);
    assert.equal(
      String((requests[1]!.init?.headers as Record<string, string>)["Content-Type"]).startsWith("multipart/related"),
      true,
    );
    assert.match(
      new TextDecoder().decode(requests[1]!.init?.body as Uint8Array),
      /Content-Type: image\/webp/,
    );
    assert.equal(listed.success, true);
    assert.equal((listed.data as any).files[0].id, "drive_1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("google drive list defers to picker when a search misses existing grants", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("Unexpected fetch");
  }) as any;

  try {
    let listQueryCount = 0;
    const listed = await driveList.execute({
      ...createGoogleToolCtx(),
      ctx: {
        ...createGoogleToolCtx().ctx,
        runQuery: async () => {
          listQueryCount += 1;
          if (listQueryCount === 1) return createGoogleToolCtx().ctx.runQuery();
          return {
            rows: [],
            totalGrantCount: 1,
            matchedGrantCount: 0,
          };
        },
      },
    } as any, {
      query: "Tenancy Agreement",
      max_results: 10,
    });

    assert.equal(listed.success, true);
    assert.equal((listed.data as any).requiresDrivePicker, true);
    assert.equal((listed.deferred as any).kind, "drive_picker");
    assert.equal((listed.deferred as any).data.reason, "no_matching_drive_file_grants");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("google drive read and move require explicit Drive Picker grants", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("Unexpected fetch before grant check");
  }) as any;

  try {
    const buildCtx = () => {
      let queryCount = 0;
      return {
        toolCtx: {
          ...createGoogleToolCtx(),
          ctx: {
            ...createGoogleToolCtx().ctx,
            runQuery: async () => {
              queryCount += 1;
              if (queryCount === 1) return createGoogleToolCtx().ctx.runQuery();
              return null;
            },
          },
        } as any,
        get queryCount() { return queryCount; },
      };
    };

    const readCtx = buildCtx();
    const moveCtx = buildCtx();
    const read = await driveRead.execute(readCtx.toolCtx, { file_id: "drive_unpicked" });
    const moved = await driveMove.execute(moveCtx.toolCtx, {
      file_id: "drive_unpicked",
      destination_folder_id: "folder_1",
    });

    assert.equal(read.success, false);
    assert.equal((read.data as any).requiresDrivePicker, true);
    assert.equal((read.data as any).fileId, "drive_unpicked");
    assert.equal(moved.success, false);
    assert.equal((moved.data as any).requiresDrivePicker, true);
    assert.equal(moveCtx.queryCount, 2);
    assert.equal(readCtx.queryCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("google drive read covers text, workspace export, binary handoff, truncation, and upstream failures", async () => {
  const originalFetch = globalThis.fetch;
  const longText = "x".repeat(100_050);
  const requests: string[] = [];

  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    if (url.includes("file_text") && url.includes("fields=")) {
      return jsonResponse(200, {
        id: "file_text",
        name: "large.json",
        mimeType: "application/json",
        size: "100050",
      });
    }
    if (url.includes("file_text") && url.includes("alt=media")) {
      return { ...jsonResponse(200, {}), text: async () => longText } as any;
    }
    if (url.includes("file_doc") && url.includes("fields=")) {
      return jsonResponse(200, {
        id: "file_doc",
        name: "Draft",
        mimeType: "application/vnd.google-apps.document",
      });
    }
    if (url.includes("file_doc") && url.includes("/export?")) {
      return { ...jsonResponse(200, {}), text: async () => "Exported document text" } as any;
    }
    if (url.includes("file_binary") && url.includes("fields=")) {
      return jsonResponse(200, {
        id: "file_binary",
        name: "scan.pdf",
        mimeType: "application/pdf",
        size: "2048",
        webViewLink: "https://drive.example/scan",
      });
    }
    if (url.includes("file_broken") && url.includes("fields=")) {
      return { ...jsonResponse(500, { error: "boom" }), text: async () => "boom" } as any;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const buildCtx = (fileId: string) => {
      let queryCount = 0;
      return {
        userId: "user_1",
        chatId: "chat_1",
        ctx: {
          runQuery: async () => {
            queryCount += 1;
            if (queryCount === 1) return createGoogleToolCtx().ctx.runQuery();
            return { fileId, name: "Granted", mimeType: "application/pdf" };
          },
          runMutation: async () => [{
            driveFileId: "file_binary",
            ref: "doc:1",
            documentId: "doc_1",
            versionId: "version_1",
            extractionStatus: "ready",
          }],
        },
      } as any;
    };

    const text = await driveRead.execute(buildCtx("file_text"), { file_id: "file_text" });
    assert.equal(text.success, true);
    assert.equal((text.data as any).truncated, true);
    assert.equal((text.data as any).characterCount, 100_000);

    const exported = await driveRead.execute(buildCtx("file_doc"), { file_id: "file_doc" });
    assert.equal(exported.success, true);
    assert.equal((exported.data as any).contentType, "Google Doc");
    assert.equal((exported.data as any).content, "Exported document text");

    const binary = await driveRead.execute(buildCtx("file_binary"), { file_id: "file_binary" });
    assert.equal(binary.success, true);
    assert.equal((binary.data as any).content, null);
    assert.equal((binary.data as any).scopedDocument.doc_id, "doc:1");

    const broken = await driveRead.execute(buildCtx("file_broken"), { file_id: "file_broken" });
    assert.equal(broken.success, false);
    assert.match(String(broken.error), /Failed to get file metadata/);
    assert.ok(requests.some((url) => url.includes("/export?mimeType=text%2Fplain")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("google drive upload and move surface storage, fetch, and Drive API failures", async () => {
  const originalFetch = globalThis.fetch;
  const missingStorage = await driveUpload.execute({
    ...createGoogleToolCtx(),
    ctx: {
      ...createGoogleToolCtx().ctx,
      storage: { getUrl: async () => null },
    },
  } as any, {
    storage_id: "missing_storage",
    filename: "missing.pdf",
  });
  assert.equal(missingStorage.success, false);
  assert.match(String(missingStorage.error), /File not found/);

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url === "https://cdn.example/storage_1") {
      return { ...jsonResponse(503, { error: "cdn down" }), blob: async () => new Blob([""]) } as any;
    }
    if (url.includes("/drive/v3/files/file_1?fields=id,name,parents")) {
      return jsonResponse(200, { id: "file_1", name: "Move me", parents: [] });
    }
    if (url.includes("/drive/v3/files/file_1?addParents=root")) {
      assert.equal(init?.method, "PATCH");
      return { ...jsonResponse(403, { error: "denied" }), text: async () => "denied" } as any;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const fetchFailure = await driveUpload.execute(createGoogleToolCtx(), {
      storage_id: "storage_1",
      filename: "Report.unknown",
    });
    assert.equal(fetchFailure.success, false);
    assert.match(String(fetchFailure.error), /Failed to fetch file/);

    let queryCount = 0;
    const moveFailure = await driveMove.execute({
      ...createGoogleToolCtx(),
      ctx: {
        ...createGoogleToolCtx().ctx,
        runQuery: async () => {
          queryCount += 1;
          if (queryCount === 1) return createGoogleToolCtx().ctx.runQuery();
          return { fileId: "file_1", name: "Move me", mimeType: "text/plain" };
        },
      },
    } as any, {
      file_id: "file_1",
      destination_folder_id: "root",
    });
    assert.equal(moveFailure.success, false);
    assert.match(String(moveFailure.error), /Drive move failed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("google drive tools cover upload API failure, move success, and read transfer failures", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];

  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    if (url === "https://cdn.example/storage_1") {
      return jsonResponse(200, {});
    }
    if (url.includes("/upload/drive/v3/files")) {
      return { ...jsonResponse(500, { error: "upload down" }), text: async () => "upload down" } as any;
    }
    if (url.includes("file_doc_export_fail") && url.includes("fields=")) {
      return jsonResponse(200, {
        id: "file_doc_export_fail",
        name: "Broken Doc",
        mimeType: "application/vnd.google-apps.document",
      });
    }
    if (url.includes("file_doc_export_fail") && url.includes("/export?")) {
      return { ...jsonResponse(429, { error: "rate limit" }), text: async () => "rate limit" } as any;
    }
    if (url.includes("file_text_download_fail") && url.includes("fields=")) {
      return jsonResponse(200, {
        id: "file_text_download_fail",
        name: "broken.txt",
        mimeType: "text/plain",
      });
    }
    if (url.includes("file_text_download_fail") && url.includes("alt=media")) {
      return { ...jsonResponse(404, { error: "missing" }), text: async () => "missing" } as any;
    }
    if (url.includes("file_binary_plain") && url.includes("fields=")) {
      return jsonResponse(200, {
        id: "file_binary_plain",
        name: "image.png",
        mimeType: "image/png",
      });
    }
    if (url.includes("/drive/v3/files/file_move?fields=id,name,parents")) {
      return jsonResponse(200, { id: "file_move", name: "Move me", parents: ["old_1", "old_2"] });
    }
    if (url.includes("/drive/v3/files/file_move?")) {
      return jsonResponse(200, {
        id: "file_move",
        name: "Move me",
        parents: ["folder_2"],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    await assert.rejects(
      driveUpload.execute(createGoogleToolCtx(), {
        storage_id: "storage_1",
        filename: "Report.pdf",
        folder_id: "folder_1",
        mime_type: "application/pdf",
      }),
      /Drive upload failed/,
    );

    const buildReadCtx = (fileId: string, chatId?: string) => {
      let queryCount = 0;
      return {
        userId: "user_1",
        chatId,
        ctx: {
          runQuery: async () => {
            queryCount += 1;
            if (queryCount === 1) return createGoogleToolCtx().ctx.runQuery();
            return { fileId, name: "Granted" };
          },
          runMutation: async () => {
            throw new Error("document handoff should be skipped");
          },
        },
      } as any;
    };

    const exportFailure = await driveRead.execute(buildReadCtx("file_doc_export_fail"), {
      file_id: "file_doc_export_fail",
    });
    assert.equal(exportFailure.success, false);
    assert.match(String(exportFailure.error), /Failed to export Google Doc/);

    const downloadFailure = await driveRead.execute(buildReadCtx("file_text_download_fail"), {
      file_id: "file_text_download_fail",
    });
    assert.equal(downloadFailure.success, false);
    assert.match(String(downloadFailure.error), /Failed to download file/);

    const binaryNoChat = await driveRead.execute(buildReadCtx("file_binary_plain"), {
      file_id: "file_binary_plain",
    });
    assert.equal(binaryNoChat.success, true);
    assert.equal((binaryNoChat.data as any).scopedDocument, undefined);
    assert.match(String((binaryNoChat.data as any).message), /File ID: file_binary_plain/);

    let queryCount = 0;
    const moved = await driveMove.execute({
      ...createGoogleToolCtx(),
      ctx: {
        ...createGoogleToolCtx().ctx,
        runQuery: async () => {
          queryCount += 1;
          if (queryCount === 1) return createGoogleToolCtx().ctx.runQuery();
          return { fileId: "file_move", name: "Move me", mimeType: "text/plain" };
        },
      },
    } as any, {
      file_id: "file_move",
      destination_folder_id: "folder_2",
    });
    assert.equal(moved.success, true);
    assert.deepEqual((moved.data as any).newParents, ["folder_2"]);
    assert.ok(requests.some((url) => url.includes("removeParents=old_1%2Cold_2")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gmail tools require manual Gmail credentials", async () => {
  const ctx = {
    userId: "user_1",
    ctx: {
      runQuery: async () => null,
    },
  } as any;

  const sent = await gmailSend.execute(ctx, {
    to: "alice@example.com",
    subject: "Update",
    body: "<p>Hello</p>",
    is_html: true,
  });
  const read = await gmailRead.execute(ctx, {
    query: "from:boss@example.com",
    include_body: true,
    max_results: 5,
  });
  const draft = await gmailCreateDraft.execute(ctx, {
    to: "alice@example.com",
    subject: "Draft",
    body: "Hello",
  });

  assert.equal(sent.success, false);
  assert.match(String(sent.error), /Manual Gmail connection/);
  assert.equal(read.success, false);
  assert.match(String(read.error), /Manual Gmail connection/);
  assert.equal(draft.success, false);
  assert.match(String(draft.error), /Manual Gmail connection/);
});

// -----------------------------------------------------------------------------
// Schema strictness — protects against Azure GPT-5 strict-mode silent drops.
// All Google Drive tool param schemas MUST set additionalProperties: false and
// use "integer" (not "number") for count-style fields. When this regressed in
// the past, GPT-5.5 on Azure consumed input tokens and emitted 0 output tokens
// (no error) the moment google-drive was loaded.
// -----------------------------------------------------------------------------

test("google drive tool schemas are strict-mode compatible", () => {
  for (const tool of [driveUpload, driveList, driveRead, driveMove]) {
    assert.equal(tool.definition.type, "function");
    if (tool.definition.type !== "function") continue;
    const params = tool.definition.function.parameters as {
      type: string;
      properties: Record<string, { type: string }>;
      additionalProperties?: boolean;
    };
    assert.equal(
      params.additionalProperties,
      false,
      `${tool.name} parameters must set additionalProperties: false ` +
        "(Azure GPT-5 strict mode rejects schemas without it and returns 0 output tokens silently)",
    );
    for (const [propName, propSchema] of Object.entries(params.properties)) {
      assert.notEqual(
        propSchema.type,
        "number",
        `${tool.name}.${propName} uses type:"number" — use type:"integer" for count-style fields ` +
          "(Azure strict mode prefers integer)",
      );
    }
  }
});
