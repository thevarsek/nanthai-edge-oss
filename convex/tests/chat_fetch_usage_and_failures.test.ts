import assert from "node:assert/strict";
import test from "node:test";

import { createMockCtx } from "../../test_helpers/convex_mock_ctx";
import {
  createFetchAndStoreGenerationUsageHandlerDepsForTest,
  createFetchGenerationDataDepsForTest,
  fetchAndStoreGenerationUsageHandler,
  fetchGenerationData,
} from "../chat/actions_fetch_usage";
import { failPendingParticipants } from "../chat/actions_run_generation_failures";
import { GenerationCancelledError } from "../chat/generation_helpers";

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as any;
}

function textResponse(status: number, text: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error("invalid json");
    },
    text: async () => text,
  } as any;
}

test("fetchGenerationData retries transient failures and returns canonical usage payloads", async () => {
  const sleeps: number[] = [];
  let calls = 0;
  const deps = createFetchGenerationDataDepsForTest({
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    fetch: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("socket hang up");
      }
      if (calls === 2) {
        return textResponse(404, "not ready");
      }
      if (calls === 3) {
        return jsonResponse(200, {
          data: {
            id: "gen_1",
            tokens_prompt: 0,
            tokens_completion: 0,
          },
        });
      }
      return jsonResponse(200, {
        data: {
          id: "gen_1",
          tokens_prompt: 10,
          tokens_completion: 5,
          total_cost: 0.12,
          is_byok: true,
          native_tokens_cached: 4,
          native_tokens_reasoning: 6,
          native_tokens_completion_images: 2,
          upstream_inference_cost: 0.03,
        },
      });
    },
  });

  const result = await fetchGenerationData("key", "gen_1", deps);
  assert.equal(calls, 4);
  assert.deepEqual(sleeps, [2000, 4000, 8000]);
  assert.equal(result?.tokens_prompt, 10);
  assert.equal(result?.is_byok, true);
});

test("fetchGenerationData returns null for malformed, missing, or non-retryable responses", async () => {
  const malformed = await fetchGenerationData("key", "gen_1", createFetchGenerationDataDepsForTest({
    fetch: async () => textResponse(200, "not-json"),
    sleep: async () => undefined,
  }));
  assert.equal(malformed, null);

  const missingData = await fetchGenerationData("key", "gen_1", createFetchGenerationDataDepsForTest({
    fetch: async () => jsonResponse(200, {}),
    sleep: async () => undefined,
  }));
  assert.equal(missingData, null);

  const serverError = await fetchGenerationData("key", "gen_1", createFetchGenerationDataDepsForTest({
    fetch: async () => textResponse(500, "boom"),
    sleep: async () => undefined,
  }));
  assert.equal(serverError, null);
});

test("fetchAndStoreGenerationUsageHandler skips missing keys or empty records and persists canonical usage fields", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const noKeyCtx = createMockCtx({
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
    },
  });

  await fetchAndStoreGenerationUsageHandler(noKeyCtx, {
    messageId: "msg_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    openrouterGenerationId: "gen_1",
  }, createFetchAndStoreGenerationUsageHandlerDepsForTest({
    getOptionalUserOpenRouterApiKey: async () => null,
  }));
  assert.equal(mutations.length, 0);

  await fetchAndStoreGenerationUsageHandler(noKeyCtx, {
    messageId: "msg_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    openrouterGenerationId: "gen_1",
  }, createFetchAndStoreGenerationUsageHandlerDepsForTest({
    getOptionalUserOpenRouterApiKey: async () => "key",
    fetchGenerationData: async () => ({
      id: "gen_1",
      tokens_prompt: 0,
      tokens_completion: 0,
    } as any),
  }));
  assert.equal(mutations.length, 0);

  await fetchAndStoreGenerationUsageHandler(noKeyCtx, {
    messageId: "msg_2" as any,
    chatId: "chat_2" as any,
    userId: "user_2",
    openrouterGenerationId: "gen_2",
  }, createFetchAndStoreGenerationUsageHandlerDepsForTest({
    getOptionalUserOpenRouterApiKey: async () => "key",
    fetchGenerationData: async () => ({
      id: "gen_2",
      tokens_prompt: 9,
      tokens_completion: 4,
      total_cost: 0.25,
      is_byok: true,
      native_tokens_cached: 3,
      native_tokens_reasoning: 2,
      native_tokens_completion_images: 1,
      upstream_inference_cost: 0.05,
      cache_discount: 0.02,
    } as any),
  }));

  assert.deepEqual(mutations, [{
    messageId: "msg_2",
    chatId: "chat_2",
    userId: "user_2",
    promptTokens: 9,
    completionTokens: 4,
    totalTokens: 13,
    cost: 0.25,
    isByok: true,
    cachedTokens: 3,
    reasoningTokens: 2,
    imageCompletionTokens: 1,
    upstreamInferenceCost: 0.05,
    cacheDiscount: 0.02,
  }]);
});

test("fetchAndStoreGenerationUsageHandler preserves non-positive cache discount values", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const ctx = createMockCtx({
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
    },
  });

  await fetchAndStoreGenerationUsageHandler(ctx, {
    messageId: "msg_3" as any,
    chatId: "chat_3" as any,
    userId: "user_3",
    openrouterGenerationId: "gen_3",
  }, createFetchAndStoreGenerationUsageHandlerDepsForTest({
    getOptionalUserOpenRouterApiKey: async () => "key",
    fetchGenerationData: async () => ({
      id: "gen_3",
      tokens_prompt: 7,
      tokens_completion: 2,
      total_cost: 0.1,
      cache_discount: -0.01,
    } as any),
  }));

  assert.equal(mutations.length, 1);
  assert.equal(mutations[0]?.cacheDiscount, -0.01);
});

test("failPendingParticipants finalizes only pending or streaming participants and maps cancellation correctly", async () => {
  const finalizations: Array<Record<string, unknown>> = [];
  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.messageId === "msg_pending") return { _id: "msg_pending", status: "pending" };
      if (args.messageId === "msg_streaming") return { _id: "msg_streaming", status: "streaming" };
      if (args.messageId === "msg_completed") return { _id: "msg_completed", status: "completed" };
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      finalizations.push(args);
    },
  });

  await failPendingParticipants(ctx, {
    chatId: "chat_1" as any,
    userId: "user_1",
    participants: [
      { messageId: "msg_pending" as any, jobId: "job_1" as any },
      { messageId: "msg_streaming" as any, jobId: "job_2" as any },
      { messageId: "msg_completed" as any, jobId: "job_3" as any },
    ],
  } as any, new GenerationCancelledError());

  assert.equal(finalizations.length, 2);
  assert.deepEqual(finalizations[0], {
    messageId: "msg_pending",
    jobId: "job_1",
    chatId: "chat_1",
    content: "[Generation cancelled]",
    status: "cancelled",
    error: "Generation cancelled",
    userId: "user_1",
    terminalErrorCode: undefined,
  });
  assert.equal(finalizations[1]?.status, "cancelled");
});

test("failPendingParticipants swallows finalize errors and continues cleanup", async () => {
  const attempts: string[] = [];
  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => ({
      _id: args.messageId,
      status: "pending",
    }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      attempts.push(String(args.messageId));
      if (args.messageId === "msg_1") {
        throw new Error("db write failed");
      }
    },
  });

  await failPendingParticipants(ctx, {
    chatId: "chat_1" as any,
    userId: "user_1",
    participants: [
      { messageId: "msg_1" as any, jobId: "job_1" as any },
      { messageId: "msg_2" as any, jobId: "job_2" as any },
    ],
  } as any, new Error("upstream failed"));

  assert.deepEqual(attempts, ["msg_1", "msg_2"]);
});
