import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { NonStreamResult } from "../lib/openrouter";
import { MODEL_IDS } from "../lib/model_constants";
import {
  createPdfExtractionDepsForTest,
  extractPdfVersionHandler,
  type ExtractPdfVersionArgs,
} from "../documents/pdf_extraction_actions";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";
const versionId = "version_1" as Id<"documentVersions">;
const storageId = "storage_1" as Id<"_storage">;
const baseArgs: ExtractPdfVersionArgs = {
  versionId,
  storageId,
  filename: "caller-name.pdf",
  toolContext: {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    userMessageId: "user_message_1",
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

function pypdfExtraction(text: string, pageCount = 1) {
  return {
    filename: "scan.pdf",
    storageId: "document-version",
    pageCount,
    text,
    textTruncated: false,
    fullTextCharCount: text.length,
    pages: [],
    metadata: {},
  };
}

function openRouterResult(
  overrides: Partial<NonStreamResult> = {},
): NonStreamResult {
  return {
    content: "ignored model prose",
    modelId: MODEL_IDS.pdfOcrExtraction,
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
        name: "scan.pdf",
        content: [{ type: "text", text: "OCR text" }],
      },
    }],
    ...overrides,
  };
}

function actionCtx(options: {
  resolvedVersion?: typeof version | null;
  blob?: Blob | null;
  mutations?: Array<Record<string, unknown>>;
} = {}) {
  return createMockCtx({
    runQuery: async () => options.resolvedVersion === undefined
      ? version
      : options.resolvedVersion,
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      options.mutations?.push(args);
      return null;
    },
    storage: {
      get: async () => options.blob === undefined
        ? new Blob(["scanned"], { type: "application/pdf" })
        : options.blob,
    },
  });
}

test("useful pypdf text bypasses OCR, key lookup, and accounting", async () => {
  let pypdfCalls = 0;
  const result = await extractPdfVersionHandler(actionCtx(), baseArgs,
    createPdfExtractionDepsForTest({
      readPdfBlob: async () => {
        pypdfCalls += 1;
        return pypdfExtraction("Existing PDF text", 3);
      },
      getRequiredUserOpenRouterApiKey: async () => {
        throw new Error("key lookup must not run");
      },
      callOpenRouterNonStreaming: async () => {
        throw new Error("provider must not run");
      },
    }));

  assert.equal(pypdfCalls, 1);
  assert.deepEqual(result, {
    text: "Existing PDF text",
    markdown: "Existing PDF text",
    pageCount: 3,
    wordCount: 3,
    ocrUsed: false,
    extractionMethod: "pypdf",
    ocrEngine: null,
    modelId: null,
    usage: null,
    generationId: null,
    ocrAccountingStatus: "not_applicable",
  });
});

test("a legitimate one-character PDF extraction bypasses OCR", async () => {
  let providerCalls = 0;
  const result = await extractPdfVersionHandler(actionCtx(), baseArgs,
    createPdfExtractionDepsForTest({
      readPdfBlob: async () => pypdfExtraction("x"),
      callOpenRouterNonStreaming: async () => {
        providerCalls += 1;
        return openRouterResult();
      },
    }));

  assert.equal(result.text, "x");
  assert.equal(result.ocrUsed, false);
  assert.equal(providerCalls, 0);
});

test("whitespace pypdf output uses the exact Mistral OCR request and annotation text", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  let providerCall: {
    apiKey: string;
    model: string;
    messages: unknown;
    params: unknown;
    retry: unknown;
  } | undefined;
  const usage = {
    promptTokens: 12,
    completionTokens: 1,
    totalTokens: 13,
    cost: 0.007,
    cachedTokens: 2,
  };
  const result = await extractPdfVersionHandler(
    actionCtx({ mutations }),
    baseArgs,
    createPdfExtractionDepsForTest({
      now: () => 1_000,
      readPdfBlob: async () => pypdfExtraction(" \n\t ", 2),
      getRequiredUserOpenRouterApiKey: async () => "user-key",
      callOpenRouterNonStreaming: async (apiKey, model, messages, params, retry) => {
        providerCall = { apiKey, model, messages, params, retry };
        return openRouterResult({
          content: "invented summary that must never be stored",
          modelId: "effective/model",
          usage,
          generationId: "gen_123",
          fileAnnotations: [{
            type: "file",
            file: {
              hash: "hash_ocr",
              content: [
                { type: "text", text: "First page" },
                { type: "image_url", image_url: { url: "data:image/png;base64,AA" } },
                { type: "text", text: "Second page" },
              ],
            },
          }],
        });
      },
    }),
  );

  assert.equal(result.text, "First page\n\nSecond page");
  assert.equal(result.markdown, result.text);
  assert.equal(result.text.includes("invented summary"), false);
  assert.equal(result.pageCount, 2);
  assert.equal(result.wordCount, 4);
  assert.equal(result.ocrUsed, true);
  assert.equal(result.modelId, "effective/model");
  assert.equal(result.ocrAccountingStatus, "recorded");
  assert.deepEqual(providerCall, {
    apiKey: "user-key",
    model: MODEL_IDS.pdfOcrExtraction,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Parse this PDF. Reply with OK." },
        {
          type: "file",
          file: {
            filename: "scan.pdf",
            file_data: `data:application/pdf;base64,${Buffer.from("scanned").toString("base64")}`,
          },
        },
      ],
    }],
    params: {
      maxTokens: 4,
      plugins: [{ id: "file-parser", pdf: { engine: "mistral-ocr" } }],
    },
    retry: {
      retryOnUnsupportedParam: false,
      recoverFileAnnotationsOnError: true,
      requestTimeoutMs: 180_000,
      totalTimeoutMs: 180_000,
      absoluteDeadlineAtMs: 481_000,
    },
  });
  assert.deepEqual(mutations, [{
    messageId: "message_1",
    chatId: "chat_1",
    userId: "user_1",
    modelId: "effective/model",
    promptTokens: 12,
    completionTokens: 1,
    totalTokens: 13,
    cost: 0.007,
    cachedTokens: 2,
    source: "pdf_ocr",
    generationId: "gen_123",
    idempotencyKey: "pdf_ocr:version_1:storage_1:mistral-ocr:gen_123",
  }]);
});

test("ZDR-scoped scanned PDFs fail closed before key lookup or provider dispatch", async () => {
  let keyCalls = 0;
  let providerCalls = 0;
  const deps = createPdfExtractionDepsForTest({
    readPdfBlob: async () => pypdfExtraction(" \n "),
    getRequiredUserOpenRouterApiKey: async () => {
      keyCalls += 1;
      return "key";
    },
    callOpenRouterNonStreaming: async () => {
      providerCalls += 1;
      return openRouterResult();
    },
  });

  await assert.rejects(
    () => extractPdfVersionHandler(actionCtx(), {
      ...baseArgs,
      toolContext: { ...baseArgs.toolContext, requireZdr: true },
    }, deps),
    /PDF_OCR_ZDR_UNAVAILABLE/,
  );
  assert.equal(keyCalls, 0);
  assert.equal(providerCalls, 0);
});

test("missing tracking and missing API keys both stop before provider dispatch", async () => {
  let providerCalls = 0;
  const provider = async () => {
    providerCalls += 1;
    return openRouterResult();
  };
  const whitespace = async () => pypdfExtraction("\t");

  await assert.rejects(
    () => extractPdfVersionHandler(actionCtx(), {
      ...baseArgs,
      toolContext: { userId: "user_1" },
    }, createPdfExtractionDepsForTest({
      readPdfBlob: whitespace,
      callOpenRouterNonStreaming: provider,
    })),
    /PDF_OCR_TRACKING_REQUIRED/,
  );
  await assert.rejects(
    () => extractPdfVersionHandler(actionCtx(), baseArgs,
      createPdfExtractionDepsForTest({
        readPdfBlob: whitespace,
        getRequiredUserOpenRouterApiKey: async () => {
          throw new ConvexError({
            code: "MISSING_API_KEY" as const,
            message: "Reconnect OpenRouter.",
          });
        },
        callOpenRouterNonStreaming: provider,
      })),
    /MISSING_API_KEY/,
  );
  assert.equal(providerCalls, 0);
});
