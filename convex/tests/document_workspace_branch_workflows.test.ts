import test from "node:test";
import assert from "node:assert/strict";

import { findInDocument, listDocuments, readDocument } from "../tools/document_workspace";
import { ScopedDocument } from "../documents/shared";

type MutationCall = {
  args: Record<string, unknown>;
};

const scopedDoc = (overrides: Partial<ScopedDocument> = {}): ScopedDocument => ({
  ref: "doc-0",
  documentId: "document_1" as any,
  versionId: "version_1" as any,
  filename: "Brief.TXT",
  title: "Brief.TXT",
  mimeType: "text/plain",
  source: "upload",
  storageId: "storage_source" as any,
  versionNumber: 2,
  extractionStatus: "ready",
  extractionTextStorageId: "storage_text" as any,
  driveFileId: "drive_1",
  ...overrides,
});

function toolCtx(options: {
  chatId?: string | null;
  docs?: ScopedDocument[];
  version?: Record<string, unknown> | null;
  storage?: Record<string, Blob | null>;
  mutationCalls?: MutationCall[];
  runAction?: (name: unknown, args: Record<string, unknown>) => Promise<unknown>;
} = {}) {
  const mutationCalls = options.mutationCalls ?? [];
  const storage = options.storage ?? {
    storage_text: new Blob(["Alpha beta alpha beta final"], { type: "text/plain" }),
  };

  return {
    userId: "user_1",
    chatId: options.chatId === null ? undefined : options.chatId ?? "chat_1",
    ctx: {
      runMutation: async (_name: unknown, args: Record<string, unknown>) => {
        mutationCalls.push({ args });
        if ("chatId" in args) {
          return options.docs ?? [scopedDoc()];
        }
        if ("leaseExpiresAt" in args) return { state: "claimed" };
        if ("status" in args) return true;
        return null;
      },
      runQuery: async () => Object.hasOwn(options, "version")
        ? options.version
        : {
          _id: "version_1",
          documentId: "document_1",
          userId: "user_1",
          storageId: "storage_source",
          filename: "Brief.TXT",
          mimeType: "text/plain",
          versionNumber: 2,
          extractionStatus: "ready",
          extractionTextStorageId: "storage_text",
        },
      runAction: options.runAction,
      storage: {
        get: async (storageId: string) => storage[storageId] ?? null,
        store: async () => "stored_extraction",
      },
    } as any,
  };
}

test("listDocuments returns an empty scoped list when a tool call has no chat", async () => {
  const mutationCalls: MutationCall[] = [];
  const result = await listDocuments.execute(toolCtx({ chatId: null, mutationCalls }), {});

  assert.equal(result.success, true);
  assert.deepEqual((result.data as any).documents, []);
  assert.equal(mutationCalls.length, 0);
});

test("listDocuments exposes scoped document handles and sync metadata", async () => {
  const result = await listDocuments.execute(toolCtx({
    docs: [
      scopedDoc({
        ref: "doc-7",
        documentId: "document_7" as any,
        versionId: "version_7" as any,
        filename: "roadmap.md",
        mimeType: "text/markdown",
        source: "drive",
        syncState: "fresh",
        driveFileId: "drive_7",
      }),
    ],
  }), {});

  assert.equal(result.success, true);
  assert.deepEqual((result.data as any).documents, [{
    doc_id: "doc-7",
    documentId: "document_7",
    versionId: "version_7",
    filename: "roadmap.md",
    mimeType: "text/markdown",
    source: "drive",
    versionNumber: 2,
    extractionStatus: "ready",
    syncState: "fresh",
    driveFileId: "drive_7",
  }]);
});

test("readDocument resolves filename case-insensitively and falls back to text when markdown is absent", async () => {
  const result = await readDocument.execute(toolCtx(), {
    doc_id: "brief.txt",
    format: "markdown",
    start_char: "not-a-number",
    max_chars: Number.POSITIVE_INFINITY,
  });

  assert.equal(result.success, true);
  assert.equal((result.data as any).content, "Alpha beta alpha beta final");
  assert.equal((result.data as any).startChar, 0);
  assert.equal((result.data as any).maxChars, 60_000);
  assert.equal((result.data as any).isTruncated, false);
});

test("readDocument can resolve storage and drive handles and prefers cached markdown", async () => {
  const ctx = toolCtx({
    docs: [scopedDoc({ extractionTextStorageId: "storage_text" as any })],
    version: {
      _id: "version_1",
      documentId: "document_1",
      userId: "user_1",
      storageId: "storage_source",
      filename: "Brief.TXT",
      mimeType: "text/plain",
      versionNumber: 2,
      extractionStatus: "ready",
      extractionTextStorageId: "storage_text",
      extractionMarkdownStorageId: "storage_markdown",
      pageCount: 4,
      wordCount: 6,
    },
    storage: {
      storage_text: new Blob(["plain content"], { type: "text/plain" }),
      storage_markdown: new Blob(["# Markdown content"], { type: "text/markdown" }),
    },
  });

  const byStorage = await readDocument.execute(ctx, { doc_id: "storage_source" });
  const byDrive = await readDocument.execute(ctx, { doc_id: "drive_1", format: "text" });

  assert.equal(byStorage.success, true);
  assert.equal((byStorage.data as any).content, "# Markdown content");
  assert.equal((byStorage.data as any).pageCount, 4);
  assert.equal((byStorage.data as any).wordCount, 6);
  assert.equal(byDrive.success, true);
  assert.equal((byDrive.data as any).content, "plain content");
});

test("readDocument reports missing current versions and missing version rows", async () => {
  const withoutCurrent = await readDocument.execute(toolCtx({
    docs: [scopedDoc({ versionId: undefined })],
  }), { doc_id: "doc-0" });

  const missingVersion = await readDocument.execute(toolCtx({ version: null }), {
    doc_id: "version_1",
  });

  assert.equal(withoutCurrent.success, false);
  assert.equal(withoutCurrent.error, "Document has no current version.");
  assert.equal(missingVersion.success, false);
  assert.equal(missingVersion.error, "Document version not found.");
});

test("readDocument records string extraction failures from storage writes", async () => {
  const mutationCalls: MutationCall[] = [];
  const result = await readDocument.execute({
    userId: "user_1",
    chatId: "chat_1",
    ctx: {
      runMutation: async (_name: unknown, args: Record<string, unknown>) => {
        mutationCalls.push({ args });
        if ("chatId" in args) return [scopedDoc({ extractionStatus: "pending" })];
        if ("leaseExpiresAt" in args) return { state: "claimed" };
        if ("status" in args) return true;
        return null;
      },
      runQuery: async () => ({
        _id: "version_1",
        documentId: "document_1",
        userId: "user_1",
        storageId: "storage_source",
        filename: "notes.json",
        mimeType: "application/octet-stream",
        versionNumber: 1,
        extractionStatus: "pending",
      }),
      storage: {
        get: async () => new Blob(["{\"ok\":true}"], { type: "application/json" }),
        store: async () => {
          throw "store exploded";
        },
      },
    } as any,
  }, { doc_id: "doc-0" });

  assert.equal(result.success, false);
  assert.equal(result.error, "store exploded");
  assert.equal(mutationCalls.at(-1)?.args.status, "error");
  assert.equal(mutationCalls.at(-1)?.args.extractionError, "store exploded");
});

test("readDocument extracts uncached PDFs through the isolated PDF action", async () => {
  const mutationCalls: MutationCall[] = [];
  const actionCalls: Array<Record<string, unknown>> = [];
  const result = await readDocument.execute(toolCtx({
    mutationCalls,
    docs: [scopedDoc({
      filename: "Brief.pdf",
      mimeType: "application/pdf",
      extractionStatus: "pending",
      extractionTextStorageId: undefined,
    })],
    version: {
      _id: "version_1",
      documentId: "document_1",
      userId: "user_1",
      storageId: "storage_source",
      filename: "Brief.pdf",
      mimeType: "application/pdf",
      versionNumber: 2,
      extractionStatus: "pending",
    },
    runAction: async (_name, args) => {
      actionCalls.push(args);
      return {
        text: "PDF text content",
        markdown: "PDF text content",
        pageCount: 3,
        wordCount: 3,
      };
    },
  }), { doc_id: "doc-0", format: "text" });

  assert.equal(result.success, true);
  assert.equal((result.data as any).content, "PDF text content");
  assert.equal((result.data as any).pageCount, 3);
  assert.deepEqual(actionCalls, [{
    versionId: "version_1",
    storageId: "storage_source",
    filename: "Brief.pdf",
    toolContext: {
      userId: "user_1",
      chatId: "chat_1",
    },
  }]);
  const readyPatch = mutationCalls.find((call) => call.args.status === "ready")?.args;
  assert.equal(readyPatch?.extractionByteLength, 16);
  assert.equal(readyPatch?.pageCount, 3);
  assert.equal(readyPatch?.wordCount, 3);
});

test("findInDocument validates scope and missing normalized queries before extracting", async () => {
  let queryCount = 0;
  const wrongScope = await findInDocument.execute(toolCtx({ docs: [] }), {
    doc_id: "doc-0",
    query: "alpha",
  });
  const missingQuery = await findInDocument.execute({
    ...toolCtx(),
    ctx: {
      ...toolCtx().ctx,
      runQuery: async () => {
        queryCount += 1;
        return null;
      },
    } as any,
  }, { doc_id: "doc-0", query: "   \n\t   " });

  assert.equal(wrongScope.success, false);
  assert.equal(wrongScope.error, "Document is not in the current chat scope.");
  assert.equal(missingQuery.success, false);
  assert.equal(missingQuery.error, "Missing query.");
  assert.equal(queryCount, 0);
});

test("findInDocument clamps result and context limits while scanning repeated matches", async () => {
  const result = await findInDocument.execute(toolCtx({
    storage: {
      storage_text: new Blob(["alpha one alpha two alpha three"], { type: "text/plain" }),
    },
  }), {
    doc_id: "document_1",
    query: " ALPHA ",
    max_results: 2,
    context_chars: 1,
  });

  assert.equal(result.success, true);
  assert.equal((result.data as any).query, "ALPHA");
  assert.equal((result.data as any).totalReturned, 2);
  assert.deepEqual((result.data as any).matches.map((match: any) => match.index), [0, 10]);
  assert.equal((result.data as any).matches[0].excerpt, "alpha one alpha two alpha");
});
