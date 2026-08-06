import assert from "node:assert/strict";
import test from "node:test";

import type { ScopedDocument } from "../documents/shared";
import { extractVersion } from "../tools/document_extraction";

const document: ScopedDocument = {
  ref: "doc-0",
  documentId: "document_1" as never,
  versionId: "version_1" as never,
  filename: "scan.pdf",
  title: "scan.pdf",
  mimeType: "application/pdf",
  source: "upload",
  storageId: "source_pdf" as never,
  versionNumber: 1,
  extractionStatus: "ready",
};

test("a legacy empty PDF cache is OCRed once and subsequent reads reuse canonical text", async () => {
  const version: Record<string, unknown> = {
    _id: "version_1",
    documentId: "document_1",
    userId: "user_1",
    storageId: "source_pdf",
    filename: "scan.pdf",
    mimeType: "application/pdf",
    versionNumber: 1,
    extractionStatus: "ready",
    extractionTextStorageId: "legacy_empty",
  };
  const storage = new Map<string, Blob>([
    ["legacy_empty", new Blob([""])],
  ]);
  let actionCalls = 0;
  let stored = 0;
  const context = {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    operationIdempotencyKey: "operation_1",
    ctx: {
      runQuery: async () => version,
      runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
        if ("leaseExpiresAt" in args) {
          Object.assign(version, {
            extractionStatus: "extracting",
            extractionLeaseOwner: args.leaseOwner,
            extractionLeaseExpiresAt: args.leaseExpiresAt,
          });
          return { state: "claimed" };
        }
        Object.assign(version, {
          extractionStatus: args.status,
          extractionMethod: args.extractionMethod,
          extractionTextStorageId: args.extractionTextStorageId,
          extractionMarkdownStorageId: args.extractionMarkdownStorageId,
          pageCount: args.pageCount,
          wordCount: args.wordCount,
          extractionLeaseOwner: undefined,
          extractionLeaseExpiresAt: undefined,
        });
        return true;
      },
      runAction: async () => {
        actionCalls += 1;
        return {
          text: "OCR canonical text",
          markdown: "OCR canonical text",
          pageCount: 1,
          wordCount: 3,
          extractionMethod: "mistral_ocr" as const,
        };
      },
      storage: {
        get: async (id: string) => storage.get(id) ?? null,
        store: async (blob: Blob) => {
          stored += 1;
          const id = `stored_${stored}`;
          storage.set(id, blob);
          return id;
        },
      },
    } as never,
  };

  const first = await extractVersion(context, document);
  const second = await extractVersion(context, document);

  assert.equal(first.text, "OCR canonical text");
  assert.equal(second.text, "OCR canonical text");
  assert.equal(actionCalls, 1);
  assert.equal(version.extractionMethod, "mistral_ocr");
});

test("a live extraction lease blocks a duplicate provider action", async () => {
  let actionCalls = 0;
  const context = {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    ctx: {
      runQuery: async () => ({
        _id: "version_1",
        documentId: "document_1",
        userId: "user_1",
        storageId: "source_pdf",
        filename: "scan.pdf",
        mimeType: "application/pdf",
        versionNumber: 1,
        extractionStatus: "pending",
      }),
      runMutation: async () => ({ state: "busy", leaseExpiresAt: Date.now() + 60_000 }),
      runAction: async () => {
        actionCalls += 1;
        return { text: "unexpected" };
      },
      storage: { get: async () => null },
    } as never,
  };

  await assert.rejects(
    () => extractVersion(context, document),
    /already in progress/,
  );
  assert.equal(actionCalls, 0);
});

test("an empty cache already marked as Mistral OCR is treated as canonical", async () => {
  let mutationCalls = 0;
  const context = {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    ctx: {
      runQuery: async () => ({
        _id: "version_1",
        documentId: "document_1",
        userId: "user_1",
        storageId: "source_pdf",
        filename: "blank.pdf",
        mimeType: "application/pdf",
        versionNumber: 1,
        extractionStatus: "ready",
        extractionMethod: "mistral_ocr",
        extractionTextStorageId: "empty_text",
      }),
      runMutation: async () => {
        mutationCalls += 1;
        return { state: "claimed" };
      },
      storage: {
        get: async () => new Blob([""]),
      },
    } as never,
  };

  const result = await extractVersion(context, {
    ...document,
    filename: "blank.pdf",
  });
  assert.equal(result.text, "");
  assert.equal(mutationCalls, 0);
});

test("a superseded cache commit deletes its candidate blobs and returns the winner", async () => {
  const deleted: string[] = [];
  let queryCount = 0;
  let storeCount = 0;
  const context = {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    ctx: {
      runQuery: async () => {
        queryCount += 1;
        return queryCount === 1
          ? {
              _id: "version_1",
              documentId: "document_1",
              userId: "user_1",
              storageId: "source_pdf",
              filename: "scan.pdf",
              mimeType: "application/pdf",
              extractionStatus: "pending",
            }
          : {
              _id: "version_1",
              documentId: "document_1",
              userId: "user_1",
              storageId: "source_pdf",
              filename: "scan.pdf",
              mimeType: "application/pdf",
              extractionStatus: "ready",
              extractionMethod: "mistral_ocr",
              extractionTextStorageId: "winner_text",
            };
      },
      runMutation: async (_reference: unknown, args: Record<string, unknown>) =>
        "leaseExpiresAt" in args ? { state: "claimed" } : false,
      runAction: async () => ({
        text: "candidate",
        markdown: "candidate markdown",
        extractionMethod: "mistral_ocr" as const,
      }),
      storage: {
        get: async (id: string) => id === "winner_text" ? new Blob(["winner"]) : null,
        store: async () => `candidate_${++storeCount}`,
        delete: async (id: string) => { deleted.push(id); },
      },
    } as never,
  };

  const result = await extractVersion(context, document);
  assert.equal(result.text, "winner");
  assert.deepEqual(deleted, ["candidate_1", "candidate_2"]);
});

test("a partial storage failure deletes the text blob already written", async () => {
  const deleted: string[] = [];
  let storeCount = 0;
  const context = {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    ctx: {
      runQuery: async () => ({
        _id: "version_1",
        documentId: "document_1",
        userId: "user_1",
        storageId: "source_pdf",
        filename: "scan.pdf",
        mimeType: "application/pdf",
        extractionStatus: "pending",
      }),
      runMutation: async (_reference: unknown, args: Record<string, unknown>) =>
        "leaseExpiresAt" in args ? { state: "claimed" } : true,
      runAction: async () => ({ text: "text", markdown: "markdown" }),
      storage: {
        get: async () => null,
        store: async () => {
          storeCount += 1;
          if (storeCount === 2) throw new Error("markdown store failed");
          return "candidate_text";
        },
        delete: async (id: string) => { deleted.push(id); },
      },
    } as never,
  };

  await assert.rejects(
    () => extractVersion(context, document),
    /markdown store failed/,
  );
  assert.deepEqual(deleted, ["candidate_text"]);
});
