import assert from "node:assert/strict";
import test from "node:test";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";
import type { Id } from "../_generated/dataModel";
import {
  createReconcileMediaGenerationUsageDepsForTest,
  reconcileMediaGenerationUsageHandler,
  recordMediaGenerationUsage,
  type MediaGenerationUsageScope,
  type ReconcileMediaGenerationUsageArgs,
} from "../tools/media_generation_usage";

const scope: MediaGenerationUsageScope = {
  messageId: "message_1" as Id<"messages">,
  chatId: "chat_1" as Id<"chats">,
  userId: "user_1",
  modelId: "provider/media-model",
  source: "media_tool_image",
  idempotencyKey: "job_1:call_1:usage",
};

test("exact inline media usage is recorded immediately", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  let scheduled = 0;
  const status = await recordMediaGenerationUsage(createMockCtx({
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      return null;
    },
    scheduler: {
      runAfter: async () => {
        scheduled += 1;
        return "scheduled_1";
      },
      runAt: async () => "unused",
    },
  }), scope, {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0.08,
    isByok: true,
    upstreamInferenceCost: 0.06,
  }, "gen_inline");

  assert.equal(status, "recorded");
  assert.equal(scheduled, 0);
  assert.deepEqual(mutations, [{
    ...scope,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0.08,
    isByok: true,
    upstreamInferenceCost: 0.06,
    generationId: "gen_inline",
  }]);
});

test("generation ID schedules authoritative reconciliation when usage is absent", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  const status = await recordMediaGenerationUsage(createMockCtx({
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
  }), scope, null, " gen_delayed ");

  assert.equal(status, "reconciliation_scheduled");
  assert.deepEqual(scheduled, [{ ...scope, generationId: "gen_delayed" }]);
});

test("BYOK media usage reconciles when inline usage omits upstream cost", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  const status = await recordMediaGenerationUsage(createMockCtx({
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
  }), scope, {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
    isByok: true,
  }, "gen_byok");

  assert.equal(status, "reconciliation_scheduled");
  assert.deepEqual(scheduled, [{ ...scope, generationId: "gen_byok" }]);
});

test("inline media usage reconciles when the provider omits BYOK status", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  const status = await recordMediaGenerationUsage(createMockCtx({
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
  }), scope, {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0.08,
  }, "gen_unknown_byok");

  assert.equal(status, "reconciliation_scheduled");
  assert.deepEqual(scheduled, [{ ...scope, generationId: "gen_unknown_byok" }]);
});

test("authoritative media reconciliation accepts exact cost with zero tokens", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const args: ReconcileMediaGenerationUsageArgs = {
    ...scope,
    generationId: "gen_cost_only",
  };
  const status = await reconcileMediaGenerationUsageHandler(createMockCtx({
    runMutation: async (_ref: unknown, mutationArgs: Record<string, unknown>) => {
      mutations.push(mutationArgs);
      return null;
    },
  }), args, createReconcileMediaGenerationUsageDepsForTest({
    getOptionalUserOpenRouterApiKey: async () => "user-key",
    fetchGenerationData: async () => ({
      id: "gen_cost_only",
      tokens_prompt: 0,
      tokens_completion: 0,
      total_cost: 0.125,
      is_byok: true,
      upstream_inference_cost: 0.1,
      native_tokens_completion_images: 2,
    }),
  }));

  assert.equal(status, "recorded");
  assert.deepEqual(mutations, [{
    ...scope,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0.125,
    isByok: true,
    imageCompletionTokens: 2,
    upstreamInferenceCost: 0.1,
    generationId: "gen_cost_only",
  }]);
});

test("media accounting remains non-fatal without usage or a generation ID", async () => {
  const status = await recordMediaGenerationUsage(createMockCtx({}), scope, null, null);
  assert.equal(status, "usage_unavailable");
});

test("BYOK reconciliation does not persist markup cost without upstream cost", async () => {
  const status = await reconcileMediaGenerationUsageHandler(createMockCtx({}), {
    ...scope,
    generationId: "gen_byok_missing_upstream",
  }, createReconcileMediaGenerationUsageDepsForTest({
    getOptionalUserOpenRouterApiKey: async () => "user-key",
    fetchGenerationData: async () => ({
      id: "gen_byok_missing_upstream",
      total_cost: 0,
      is_byok: true,
    }),
  }));

  assert.equal(status, "usage_unavailable");
});
