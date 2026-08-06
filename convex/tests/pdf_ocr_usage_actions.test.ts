import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { NonStreamResult } from "../lib/openrouter";
import { PDF_OCR_ENGINE } from "../documents/pdf_ocr_fallback";
import {
  createReconcilePdfOcrUsageDepsForTest,
  pdfOcrIdempotencyKey,
  reconcilePdfOcrUsageHandler,
  recordPdfOcrUsage,
  type PdfOcrUsageScope,
  type ReconcilePdfOcrUsageArgs,
} from "../documents/pdf_ocr_usage_actions";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

const scope: PdfOcrUsageScope = {
  versionId: "version_1" as Id<"documentVersions">,
  storageId: "storage_1" as Id<"_storage">,
  userId: "user_1",
  chatId: "chat_1" as Id<"chats">,
  messageId: "message_1" as Id<"messages">,
  modelId: "effective/model",
  ocrEngine: PDF_OCR_ENGINE,
};

function result(overrides: Partial<NonStreamResult> = {}): NonStreamResult {
  return {
    content: "OK",
    modelId: "effective/model",
    usage: null,
    finishReason: "stop",
    audioBase64: "",
    audioTranscript: "",
    generationId: null,
    annotations: [],
    fileAnnotations: [],
    ...overrides,
  };
}

test("PDF OCR idempotency is generation-specific within version, storage, and engine", () => {
  const first = pdfOcrIdempotencyKey(scope, "gen_1");
  const replay = pdfOcrIdempotencyKey(scope, " gen_1 ");
  const second = pdfOcrIdempotencyKey(scope, "gen_2");

  assert.equal(
    first,
    "pdf_ocr:version_1:storage_1:mistral-ocr:gen_1",
  );
  assert.equal(replay, first);
  assert.notEqual(second, first);
  assert.equal(
    pdfOcrIdempotencyKey(scope, null),
    "pdf_ocr:version_1:storage_1:mistral-ocr:unattributed",
  );
});

test("authoritative reconciliation stores exact total_cost and generation usage", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  let keyUserId: string | undefined;
  let fetched: { apiKey: string; generationId: string } | undefined;
  const args: ReconcilePdfOcrUsageArgs = {
    ...scope,
    generationId: "gen_1",
  };
  const status = await reconcilePdfOcrUsageHandler(createMockCtx({
    runMutation: async (_ref: unknown, mutationArgs: Record<string, unknown>) => {
      mutations.push(mutationArgs);
      return null;
    },
  }), args, createReconcilePdfOcrUsageDepsForTest({
    getRequiredUserOpenRouterApiKey: async (_ctx, userId) => {
      keyUserId = userId;
      return "user-key";
    },
    fetchGenerationData: async (apiKey, generationId) => {
      fetched = { apiKey, generationId };
      return {
        id: generationId,
        tokens_prompt: 31,
        tokens_completion: 2,
        total_cost: 0.0125,
        is_byok: true,
        native_tokens_cached: 4,
        native_tokens_reasoning: 3,
        upstream_inference_cost: 0.004,
      };
    },
  }));

  assert.equal(status, "recorded");
  assert.equal(keyUserId, "user_1");
  assert.deepEqual(fetched, { apiKey: "user-key", generationId: "gen_1" });
  assert.deepEqual(mutations, [{
    messageId: "message_1",
    chatId: "chat_1",
    userId: "user_1",
    modelId: "effective/model",
    promptTokens: 31,
    completionTokens: 2,
    totalTokens: 33,
    cost: 0.0125,
    isByok: true,
    cachedTokens: 4,
    reasoningTokens: 3,
    upstreamInferenceCost: 0.004,
    source: "pdf_ocr",
    generationId: "gen_1",
    idempotencyKey: "pdf_ocr:version_1:storage_1:mistral-ocr:gen_1",
  }]);
});

test("missing exact cost schedules one authoritative reconciliation", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  const status = await recordPdfOcrUsage(createMockCtx({
    scheduler: {
      runAfter: async (
        _delay: number,
        _ref: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push(args);
        return "scheduled_1";
      },
      runAt: async () => "unused",
    },
  }), scope, result({
    generationId: "gen_reconcile",
    usage: {
      promptTokens: 10,
      completionTokens: 1,
      totalTokens: 11,
    },
  }));

  assert.equal(status, "authoritative_cost_required");
  assert.deepEqual(scheduled, [{ ...scope, generationId: "gen_reconcile" }]);
});

test("missing exact cost and generation reports unavailable without scheduling", async () => {
  let scheduled = 0;
  const status = await recordPdfOcrUsage(createMockCtx({
    scheduler: {
      runAfter: async () => {
        scheduled += 1;
        return "unexpected";
      },
      runAt: async () => "unused",
    },
  }), scope, result({
    usage: {
      promptTokens: 10,
      completionTokens: 1,
      totalTokens: 11,
    },
  }));

  assert.equal(status, "usage_unavailable");
  assert.equal(scheduled, 0);
});

test("failed immediate exact-cost write schedules the idempotent mutation once", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  const status = await recordPdfOcrUsage(createMockCtx({
    runMutation: async () => {
      throw new Error("temporary mutation failure");
    },
    scheduler: {
      runAfter: async (
        _delay: number,
        _ref: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push(args);
        return "scheduled_1";
      },
      runAt: async () => "unused",
    },
  }), scope, result({
    generationId: "gen_paid",
    usage: {
      promptTokens: 20,
      completionTokens: 2,
      totalTokens: 22,
      cost: 0.02,
    },
  }));

  assert.equal(status, "record_scheduled");
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]?.cost, 0.02);
  assert.equal(scheduled[0]?.generationId, "gen_paid");
  assert.equal(
    scheduled[0]?.idempotencyKey,
    "pdf_ocr:version_1:storage_1:mistral-ocr:gen_paid",
  );
});

test("reconciliation refuses non-authoritative costs", async () => {
  let mutations = 0;
  const status = await reconcilePdfOcrUsageHandler(createMockCtx({
    runMutation: async () => {
      mutations += 1;
      return null;
    },
  }), { ...scope, generationId: "gen_missing_cost" },
  createReconcilePdfOcrUsageDepsForTest({
    getRequiredUserOpenRouterApiKey: async () => "user-key",
    fetchGenerationData: async () => ({
      id: "gen_missing_cost",
      tokens_prompt: 10,
      tokens_completion: 1,
    }),
  }));

  assert.equal(status, "usage_unavailable");
  assert.equal(mutations, 0);
});
