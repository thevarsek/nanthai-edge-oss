import test from "node:test";
import assert from "node:assert/strict";

import { parseDocumentCitations, quoteExistsInText, stripCitationBlock } from "../documents/shared";
import { resolvePerplexityCitations } from "../lib/openrouter_types";
import { readDocument } from "../tools/document_workspace";

test("quoteExistsInText tolerates PDF extraction spaces inside words", () => {
  const extracted = "all such Inventions and work s shall automatically, on creation, vin the Company absolutely";
  const quote = "all such Inventions and works shall automatically, on creation, vin the Company absolutely";

  assert.equal(quoteExistsInText(quote, extracted), true);
});

test("quoteExistsInText still rejects text absent from the document", () => {
  const extracted = "During your employment and without prior written consent from a director";
  const quote = "This employee may freely work for any competitor without consent";

  assert.equal(quoteExistsInText(quote, extracted), false);
});

test("parseDocumentCitations handles OpenRouter citation block from contract review", () => {
  const content = `The main clause is clause 19 [1].

<CITATIONS>
[
  {
    "ref": 1,
    "doc_id": "doc-0",
    "page": 9,
    "quote": "all work embodying Intellectual Property Rights made wholly or partially by you at any time during the course of your employment"
  }
]
</CITATIONS>`;

  assert.deepEqual(parseDocumentCitations(content), [{
    ref: 1,
    docId: "doc-0",
    page: 9,
    locator: undefined,
    quote: "all work embodying Intellectual Property Rights made wholly or partially by you at any time during the course of your employment",
  }]);
});

test("parseDocumentCitations drops malformed entries and keeps recoverable citations", () => {
  const content = `<CITATIONS>
[
  {"ref": "1", "doc_id": "doc-0", "quote": "valid quote"},
  {"ref": 2, "doc_id": "doc-1"},
  {"ref": 3, "quote": "missing document"},
  null
]
</CITATIONS>`;

  assert.deepEqual(parseDocumentCitations(content), [{
    ref: 1,
    docId: "doc-0",
    page: undefined,
    locator: undefined,
    quote: "valid quote",
  }]);
});

test("stripCitationBlock removes partial streaming citation blocks", () => {
  assert.equal(
    stripCitationBlock("Answer text.\n\n<CITATIONS>\n["),
    "Answer text.",
  );
});

test("stripCitationBlock preserves text after a closed citation block", () => {
  assert.equal(
    stripCitationBlock("Answer.\n<CITATIONS>[]</CITATIONS>\nFollow-up."),
    "Answer.\n\nFollow-up.",
  );
});

test("readDocument marks extraction errors terminal instead of leaving versions extracting", async () => {
  const mutationCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await readDocument.execute({
    userId: "user_1",
    chatId: "chat_1",
    ctx: {
      runMutation: async (name: unknown, args: Record<string, unknown>) => {
        mutationCalls.push({ name: typeof name === "string" ? name : "mutation", args });
        if (mutationCalls.length === 1) {
          return [{
            ref: "doc-0",
            documentId: "document_1",
            versionId: "version_1",
            filename: "missing.txt",
            title: "missing.txt",
            mimeType: "text/plain",
            source: "upload",
            storageId: "storage_1",
            versionNumber: 1,
            extractionStatus: "pending",
          }];
        }
        return null;
      },
      runQuery: async () => ({
        _id: "version_1",
        documentId: "document_1",
        userId: "user_1",
        storageId: "storage_1",
        filename: "missing.txt",
        mimeType: "text/plain",
        versionNumber: 1,
        extractionStatus: "pending",
      }),
      storage: {
        get: async () => null,
      },
    } as any,
  }, { doc_id: "doc-0" });

  assert.equal(result.success, false);
  assert.equal(result.error, "Document bytes not found.");
  assert.equal(mutationCalls.at(-1)?.args.status, "error");
  assert.equal(mutationCalls.at(-1)?.args.extractionError, "Document bytes not found.");
});

test("readDocument extracts text to out-of-row storage and returns full content", async () => {
  const storedBlobs: Blob[] = [];
  const mutationCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const longText = "alpha ".repeat(1200).trim();
  const result = await readDocument.execute({
    userId: "user_1",
    chatId: "chat_1",
    ctx: {
      runMutation: async (name: unknown, args: Record<string, unknown>) => {
        mutationCalls.push({ name: typeof name === "string" ? name : "mutation", args });
        if (mutationCalls.length === 1) {
          return [{
            ref: "doc-0",
            documentId: "document_1",
            versionId: "version_1",
            filename: "long.txt",
            title: "long.txt",
            mimeType: "text/plain",
            source: "upload",
            storageId: "storage_source",
            versionNumber: 1,
            extractionStatus: "pending",
          }];
        }
        return null;
      },
      runQuery: async () => ({
        _id: "version_1",
        documentId: "document_1",
        userId: "user_1",
        storageId: "storage_source",
        filename: "long.txt",
        mimeType: "text/plain",
        versionNumber: 1,
        extractionStatus: "pending",
      }),
      storage: {
        get: async (storageId: string) => storageId === "storage_source"
          ? new Blob([longText], { type: "text/plain" })
          : null,
        store: async (blob: Blob) => {
          storedBlobs.push(blob);
          return `storage_extraction_${storedBlobs.length}`;
        },
      },
    } as any,
  }, { doc_id: "doc-0", format: "text" });

  assert.equal(result.success, true);
  assert.equal((result.data as any).content, longText);
  assert.equal(storedBlobs.length, 2);
  const readyPatch = mutationCalls.find((call) => call.args.status === "ready")?.args;
  assert.equal(readyPatch?.extractionTextStorageId, "storage_extraction_1");
  assert.equal(readyPatch?.extractionMarkdownStorageId, "storage_extraction_2");
  assert.equal(readyPatch?.extractionByteLength, new TextEncoder().encode(longText).byteLength);
});

test("readDocument windows large document content before returning it to the model", async () => {
  const longText = "0123456789".repeat(13_000);
  const result = await readDocument.execute({
    userId: "user_1",
    chatId: "chat_1",
    ctx: {
      runMutation: async () => [{
        ref: "doc-0",
        documentId: "document_1",
        versionId: "version_1",
        filename: "large.txt",
        title: "large.txt",
        mimeType: "text/plain",
        source: "upload",
        storageId: "storage_source",
        versionNumber: 1,
        extractionStatus: "ready",
        extractionTextStorageId: "storage_extracted",
      }],
      runQuery: async () => ({
        _id: "version_1",
        documentId: "document_1",
        userId: "user_1",
        storageId: "storage_source",
        filename: "large.txt",
        mimeType: "text/plain",
        versionNumber: 1,
        extractionStatus: "ready",
        extractionTextStorageId: "storage_extracted",
      }),
      storage: {
        get: async () => new Blob([longText], { type: "text/plain" }),
      },
    } as any,
  }, { doc_id: "doc-0", format: "text", start_char: 10, max_chars: 25 });

  assert.equal(result.success, true);
  assert.equal((result.data as any).content, longText.slice(10, 35));
  assert.equal((result.data as any).returnedCharCount, 25);
  assert.equal((result.data as any).totalCharCount, longText.length);
  assert.equal((result.data as any).isTruncated, true);
  assert.equal((result.data as any).nextStartChar, 35);
});

test("readDocument marks unsupported readable-looking rows as unsupported", async () => {
  const mutationCalls: Array<{ args: Record<string, unknown> }> = [];
  const result = await readDocument.execute({
    userId: "user_1",
    chatId: "chat_1",
    ctx: {
      runMutation: async (_name: unknown, args: Record<string, unknown>) => {
        mutationCalls.push({ args });
        if (mutationCalls.length === 1) {
          return [{
            ref: "doc-0",
            documentId: "document_1",
            versionId: "version_1",
            filename: "archive.bin",
            title: "archive.bin",
            mimeType: "application/octet-stream",
            source: "upload",
            storageId: "storage_1",
            versionNumber: 1,
            extractionStatus: "pending",
          }];
        }
        return null;
      },
      runQuery: async () => ({
        _id: "version_1",
        documentId: "document_1",
        userId: "user_1",
        storageId: "storage_1",
        filename: "archive.bin",
        mimeType: "application/octet-stream",
        versionNumber: 1,
        extractionStatus: "pending",
      }),
      storage: { get: async () => new Blob(["bytes"]) },
    } as any,
  }, { doc_id: "doc-0" });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /Unsupported readable document type/);
  assert.equal(mutationCalls.at(-1)?.args.status, "unsupported");
});

test("readDocument refuses documents outside the explicit chat scope", async () => {
  let extractionQueryCount = 0;
  const result = await readDocument.execute({
    userId: "user_1",
    chatId: "chat_1",
    ctx: {
      runMutation: async () => [],
      runQuery: async () => {
        extractionQueryCount += 1;
        return null;
      },
      storage: { get: async () => null },
    } as any,
  }, { doc_id: "document_elsewhere" });

  assert.equal(result.success, false);
  assert.equal(result.error, "Document is not in the current chat scope.");
  assert.equal(extractionQueryCount, 0);
});

test("resolvePerplexityCitations preserves refs claimed by document citations", () => {
  const content = "The contract says this [1], while web context says that [2].";
  const resolved = resolvePerplexityCitations(
    content,
    [
      {
        type: "url_citation",
        url_citation: { url: "https://example.com/doc", title: "Wrong web doc" },
      },
      {
        type: "url_citation",
        url_citation: { url: "https://example.com/web", title: "Web source" },
      },
    ],
    { skipRefs: new Set([1]) },
  );

  assert.equal(
    resolved,
    "The contract says this [1], while web context says that [2. Web source](https://example.com/web).",
  );
});
