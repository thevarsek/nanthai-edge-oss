import assert from "node:assert/strict";
import test from "node:test";

import { driveRead } from "../tools/google/drive";

// =============================================================================
// Regression: when drive_read encounters a binary file (PDF, etc.) that has
// already been imported into the current chat's document workspace, the
// response must surface a `scopedDocument` handle so the model can call
// `read_document` / `find_in_document` instead of giving up.
//
// This addresses the demo failure mode where Opus 4.6 fetched a Drive PDF,
// got `content: null` ("binary file"), then attempted a public Drive URL
// download (sign-in wall) and reported "I can't read the file" — even though
// NanthAI had already imported the PDF into the workspace as `doc-0`.
// =============================================================================

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    headers: {
      get: (_name: string) => null,
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as any;
}

const PDF_FILE_ID = "drive_pdf_abc123";
const PDF_META = {
  id: PDF_FILE_ID,
  name: "The Seven Neighbours.pdf",
  mimeType: "application/pdf",
  size: "263000",
  webViewLink: "https://drive.google.com/file/d/drive_pdf_abc123/view",
};

function buildToolCtx(opts: {
  scopedDocs: Array<{
    ref: string;
    documentId: string;
    versionId?: string;
    driveFileId?: string;
    extractionStatus?: string;
    [k: string]: unknown;
  }>;
  chatId?: string | undefined;
  ensureMutationCalls?: { count: number };
}) {
  return {
    userId: "user_1",
    chatId: opts.chatId,
    ctx: {
      runQuery: async () => ({
        _id: "google_1",
        userId: "user_1",
        provider: "google",
        accessToken: "google_token",
        refreshToken: "refresh_1",
        expiresAt: Date.now() + 60 * 60 * 1000,
        scopes: ["https://www.googleapis.com/auth/drive.file"],
        email: "owner@example.com",
        status: "active",
        connectedAt: 1,
        // Drive file grant lookup result — matches by fileId
        fileId: PDF_FILE_ID,
      }),
      runMutation: async () => {
        if (opts.ensureMutationCalls) opts.ensureMutationCalls.count += 1;
        return opts.scopedDocs;
      },
      storage: { getUrl: async () => null },
    },
  } as any;
}

test("drive_read on binary PDF surfaces scopedDocument handle when already imported", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (url.includes(`/files/${PDF_FILE_ID}?fields=`)) {
      return jsonResponse(200, PDF_META);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const ensureCalls = { count: 0 };
    const toolCtx = buildToolCtx({
      chatId: "chat_42",
      ensureMutationCalls: ensureCalls,
      scopedDocs: [
        {
          ref: "doc-0",
          documentId: "doc_pdf_1",
          versionId: "ver_pdf_1",
          driveFileId: PDF_FILE_ID,
          extractionStatus: "ready",
          filename: "The Seven Neighbours.pdf",
          title: "The Seven Neighbours.pdf",
          mimeType: "application/pdf",
          source: "drive",
          storageId: "storage_pdf_1",
        },
      ],
    });

    const result = await driveRead.execute(toolCtx, { file_id: PDF_FILE_ID });

    assert.equal(result.success, true);
    const data = result.data as {
      content: string | null;
      scopedDocument?: { doc_id: string; documentId: string };
      message: string;
    };
    assert.equal(data.content, null, "binary file content stays null");
    assert.ok(data.scopedDocument, "scopedDocument should be populated");
    assert.equal(data.scopedDocument!.doc_id, "doc-0");
    assert.equal(data.scopedDocument!.documentId, "doc_pdf_1");
    // Message must explicitly direct the model to read_document. This phrasing
    // is load-bearing: it's how the model recognises the handoff.
    assert.match(
      data.message,
      /read_document/,
      "message must reference read_document so the model knows to call it",
    );
    assert.match(
      data.message,
      /doc-0/,
      "message must include the actual doc_id",
    );
    assert.equal(
      ensureCalls.count,
      1,
      "ensureDocumentsForChat must be called exactly once",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("drive_read on binary PDF without a matching scoped doc returns plain message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (url.includes(`/files/${PDF_FILE_ID}?fields=`)) {
      return jsonResponse(200, PDF_META);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const toolCtx = buildToolCtx({
      chatId: "chat_42",
      // Workspace has unrelated docs, none matches PDF_FILE_ID
      scopedDocs: [
        {
          ref: "doc-0",
          documentId: "doc_other",
          driveFileId: "other_drive_id",
          filename: "Other.pdf",
          title: "Other.pdf",
          mimeType: "application/pdf",
          source: "drive",
          storageId: "storage_other",
        },
      ],
    });

    const result = await driveRead.execute(toolCtx, { file_id: PDF_FILE_ID });

    assert.equal(result.success, true);
    const data = result.data as {
      content: string | null;
      scopedDocument?: unknown;
      message: string;
    };
    assert.equal(data.content, null);
    assert.equal(data.scopedDocument, undefined);
    assert.doesNotMatch(data.message, /read_document/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("drive_read on binary file without chatId silently skips workspace lookup", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (url.includes(`/files/${PDF_FILE_ID}?fields=`)) {
      return jsonResponse(200, PDF_META);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const ensureCalls = { count: 0 };
    const toolCtx = buildToolCtx({
      chatId: undefined,
      ensureMutationCalls: ensureCalls,
      scopedDocs: [],
    });

    const result = await driveRead.execute(toolCtx, { file_id: PDF_FILE_ID });

    assert.equal(result.success, true);
    assert.equal((result.data as any).content, null);
    assert.equal((result.data as any).scopedDocument, undefined);
    assert.equal(
      ensureCalls.count,
      0,
      "no chatId → must not call ensureDocumentsForChat",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("drive_read tolerates ensureDocumentsForChat throwing (correlation must not break binary response)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (url.includes(`/files/${PDF_FILE_ID}?fields=`)) {
      return jsonResponse(200, PDF_META);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const toolCtx = {
      userId: "user_1",
      chatId: "chat_42",
      ctx: {
        runQuery: async () => ({
          _id: "google_1",
          userId: "user_1",
          provider: "google",
          accessToken: "google_token",
          refreshToken: "refresh_1",
          expiresAt: Date.now() + 60 * 60 * 1000,
          scopes: ["https://www.googleapis.com/auth/drive.file"],
          email: "owner@example.com",
          status: "active",
          connectedAt: 1,
          fileId: PDF_FILE_ID,
        }),
        runMutation: async () => {
          throw new Error("simulated workspace lookup failure");
        },
        storage: { getUrl: async () => null },
      },
    } as any;

    const result = await driveRead.execute(toolCtx, { file_id: PDF_FILE_ID });

    assert.equal(result.success, true, "binary metadata response still succeeds");
    assert.equal((result.data as any).content, null);
    assert.equal((result.data as any).scopedDocument, undefined);
    // baseline message preserved
    assert.match((result.data as any).message, /is a binary file/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
