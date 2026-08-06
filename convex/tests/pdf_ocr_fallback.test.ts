import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { NonStreamResult } from "../lib/openrouter";
import {
  createPdfExtractionDepsForTest,
  extractPdfVersionHandler,
  type ExtractPdfVersionArgs,
} from "../documents/pdf_extraction_actions";
import { canonicalTextFromFileAnnotations } from "../documents/pdf_ocr_fallback";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

const versionId = "version_1" as Id<"documentVersions">;
const storageId = "storage_1" as Id<"_storage">;
const args: ExtractPdfVersionArgs = {
  versionId,
  storageId,
  filename: "scan.pdf",
  toolContext: {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
  },
};
const version = {
  _id: versionId,
  documentId: "document_1" as Id<"documents">,
  userId: "user_1",
  storageId,
  filename: "scan.pdf",
  mimeType: "application/pdf",
  versionNumber: 1,
  extractionStatus: "pending",
};

function whitespaceExtraction() {
  return {
    filename: "scan.pdf",
    storageId: "document-version",
    pageCount: 1,
    text: " \n\t",
    textTruncated: false,
    fullTextCharCount: 3,
    pages: [],
    metadata: {},
  };
}

function result(overrides: Partial<NonStreamResult> = {}): NonStreamResult {
  return {
    content: "do not persist this",
    modelId: "effective/model",
    usage: null,
    finishReason: "stop",
    audioBase64: "",
    audioTranscript: "",
    generationId: null,
    annotations: [],
    fileAnnotations: [{
      type: "file",
      file: {
        hash: "hash_1",
        content: [{ type: "text", text: "Canonical OCR" }],
      },
    }],
    ...overrides,
  };
}

function ctxFor(
  resolvedVersion: typeof version | null = version,
  mutations?: Array<Record<string, unknown>>,
  scheduled?: Array<Record<string, unknown>>,
) {
  return createMockCtx({
    runQuery: async () => resolvedVersion,
    runMutation: async (_ref: unknown, mutationArgs: Record<string, unknown>) => {
      mutations?.push(mutationArgs);
      return null;
    },
    storage: {
      get: async () => new Blob(["scan"], { type: "application/pdf" }),
    },
    scheduler: {
      runAfter: async (
        _delay: number,
        _ref: unknown,
        scheduledArgs: Record<string, unknown>,
      ) => {
        scheduled?.push(scheduledArgs);
        return "scheduled_1";
      },
      runAt: async () => "unused",
    },
  });
}

function scannedDeps(providerResult: NonStreamResult = result()) {
  return createPdfExtractionDepsForTest({
    readPdfBlob: async () => whitespaceExtraction(),
    getRequiredUserOpenRouterApiKey: async () => "key",
    callOpenRouterNonStreaming: async () => providerResult,
    now: () => 0,
  });
}

test("version ownership and storage identity are checked before bytes are read", async () => {
  let storageReads = 0;
  const foreignCtx = createMockCtx({
    runQuery: async () => ({ ...version, userId: "user_2" }),
    storage: {
      get: async () => {
        storageReads += 1;
        return new Blob(["scan"]);
      },
    },
  });
  const mismatchedCtx = createMockCtx({
    runQuery: async () => ({
      ...version,
      storageId: "different_storage" as Id<"_storage">,
    }),
    storage: {
      get: async () => {
        storageReads += 1;
        return new Blob(["scan"]);
      },
    },
  });

  await assert.rejects(
    () => extractPdfVersionHandler(foreignCtx, args, scannedDeps()),
    /FORBIDDEN/,
  );
  await assert.rejects(
    () => extractPdfVersionHandler(mismatchedCtx, args, scannedDeps()),
    /VALIDATION_ERROR/,
  );
  assert.equal(storageReads, 0);
});

test("missing and malformed file annotations fail clearly while valid blanks are canonical", async () => {
  await assert.rejects(
    () => extractPdfVersionHandler(ctxFor(), args, scannedDeps(result({
      fileAnnotations: undefined,
    }))),
    /returned no file annotations/,
  );
  assert.throws(
    () => canonicalTextFromFileAnnotations([{
      type: "file",
      file: { hash: "hash", content: [{ type: "text", text: 42 }] },
    }]),
    /malformed PDF annotation text/,
  );
  assert.equal(
    canonicalTextFromFileAnnotations([{
      type: "file",
      file: {
        hash: "hash",
        content: [
          { type: "text", text: " \n\t" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AA" } },
        ],
      },
    }]),
    "",
  );
});

test("missing exact cost never invokes token-price ancillary estimation", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const extraction = await extractPdfVersionHandler(
    ctxFor(version, mutations, scheduled),
    args,
    scannedDeps(result({
      generationId: "gen_missing_cost",
      usage: {
        promptTokens: 20,
        completionTokens: 1,
        totalTokens: 21,
      },
    })),
  );

  assert.equal(extraction.text, "Canonical OCR");
  assert.equal(extraction.ocrAccountingStatus, "authoritative_cost_required");
  assert.deepEqual(mutations, []);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]?.generationId, "gen_missing_cost");
});

test("OCR shares the parent provider deadline and caps its retry budget", async () => {
  let capturedRetry: Record<string, unknown> | undefined;
  const extraction = await extractPdfVersionHandler(
    ctxFor(),
    {
      ...args,
      toolContext: { ...args.toolContext, providerDeadlineAtMs: 160_000 },
    },
    createPdfExtractionDepsForTest({
      readPdfBlob: async () => whitespaceExtraction(),
      getRequiredUserOpenRouterApiKey: async () => "key",
      callOpenRouterNonStreaming: async (
        _key,
        _model,
        _messages,
        _params,
        retryConfig,
      ) => {
        capturedRetry = retryConfig as Record<string, unknown>;
        return result();
      },
      now: (() => {
        const values = [0, 10_000];
        return () => values.shift() ?? 10_000;
      })(),
    }),
  );

  assert.equal(extraction.ocrUsed, true);
  assert.deepEqual(capturedRetry, {
    retryOnUnsupportedParam: false,
    recoverFileAnnotationsOnError: true,
    requestTimeoutMs: 90_000,
    totalTimeoutMs: 90_000,
    absoluteDeadlineAtMs: 160_000,
  });
});

test("OCR reserves a final minute and refuses dispatch without a useful OCR budget", async () => {
  let providerCalls = 0;
  await assert.rejects(
    () => extractPdfVersionHandler(ctxFor(), {
      ...args,
      toolContext: { ...args.toolContext, providerDeadlineAtMs: 90_000 },
    }, createPdfExtractionDepsForTest({
      readPdfBlob: async () => whitespaceExtraction(),
      getRequiredUserOpenRouterApiKey: async () => "key",
      callOpenRouterNonStreaming: async () => {
        providerCalls += 1;
        return result();
      },
      now: () => 0,
    })),
    /PDF_OCR_DEADLINE_EXHAUSTED/,
  );
  assert.equal(providerCalls, 0);
});
