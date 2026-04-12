import assert from "node:assert/strict";
import test from "node:test";

import { createMockCtx } from "../../test_helpers/convex_mock_ctx";
import {
  createRunParticipantTurnDepsForTest,
  runParticipantTurn,
} from "../autonomous/actions_run_cycle_turn";

function buildParams(overrides: Record<string, unknown> = {}) {
  return {
    ctx: {} as any,
    sessionId: "session_1" as any,
    chatId: "chat_1" as any,
    participant: {
      participantId: "p1",
      modelId: "model_1",
      displayName: "Alpha",
      systemPrompt: "Base prompt",
      temperature: 0.6,
      maxTokens: 400,
      includeReasoning: true,
      reasoningEffort: "high",
    },
    cycleParentIds: ["msg_seed" as any],
    modelCapabilities: new Map([
      ["model_1", {
        provider: "openai",
        supportedParameters: ["reasoning"],
        hasVideoInput: true,
        hasReasoning: true,
        contextLength: 9000,
      }],
    ]),
    memoryContext: "fallback memory",
    moderatorConfig: undefined,
    userId: "user_1",
    webSearchEnabled: true,
    ...overrides,
  };
}

function createAutonomousCtx() {
  const mutations: Array<Record<string, unknown>> = [];
  const queryCalls: Array<Record<string, unknown>> = [];
  let insertCount = 0;
  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      queryCalls.push(args);
      if (args.chatId) {
        return [{ _id: "msg_existing", role: "user", content: "hello" }];
      }
      // isJobCancelled (now an internalQuery)
      if (Object.keys(args).length === 1 && "jobId" in args) {
        return false;
      }
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (insertCount === 0) {
        insertCount += 1;
        return "msg_new";
      }
      if (insertCount === 1) {
        insertCount += 1;
        return "job_new";
      }
      return undefined;
    },
  });

  return { ctx, mutations, queryCalls };
}

test("runParticipantTurn cleans up transient entities when no request messages remain", async () => {
  const { ctx, mutations } = createAutonomousCtx();
  const deps = createRunParticipantTurnDepsForTest({
    getRequiredUserOpenRouterApiKey: async () => "key",
    loadMemoryContext: async () => undefined,
    buildRequestMessages: () => [],
  });

  const result = await runParticipantTurn({
    ...buildParams(),
    ctx,
  }, deps);

  assert.deepEqual(result, { kind: "skipped" });
  assert.equal(
    mutations.some((entry) => entry.messageId === "msg_new" && !("content" in entry)),
    true,
  );
  assert.equal(
    mutations.some((entry) => entry.jobId === "job_new" && !("status" in entry)),
    true,
  );
  assert.equal(
    mutations.some((entry) => entry.status === "completed"),
    false,
  );
});

test("runParticipantTurn finalizes reasoning-only responses and propagates moderator directives and gated params", async () => {
  const { ctx, mutations } = createAutonomousCtx();
  const gateCalls: unknown[] = [];
  const requestInputs: unknown[] = [];
  const streamCalls: Array<{ messages: unknown; params: unknown }> = [];

  const deps = createRunParticipantTurnDepsForTest({
    getRequiredUserOpenRouterApiKey: async () => "key",
    generateModeratorDirective: async () => "Challenge weak assumptions.",
    loadMemoryContext: async () => "resolved memory",
    buildRequestMessages: (args: unknown) => {
      requestInputs.push(args);
      return [{ role: "user", content: "Discuss architecture tradeoffs" }];
    },
    promoteLatestUserVideoUrls: (messages: any) => ({
      messages,
      events: [],
    }),
    gateParameters: (...args: unknown[]) => {
      gateCalls.push(args);
      return { temperature: 0.2, includeReasoning: true };
    },
    createStreamWriter: () => ({
      handleContentDeltaBoundary: async () => undefined,
      appendContent: async () => undefined,
      patchContentIfNeeded: async () => undefined,
      appendReasoning: async () => undefined,
      patchReasoningIfNeeded: async () => undefined,
      flush: async () => undefined,
      totalReasoning: "writer reasoning",
      hasSeenContentDelta: false,
    }) as any,
    callOpenRouterStreaming: async (_apiKey: string, _model: string, messages, params) => {
      streamCalls.push({ messages, params });
      return {
        content: "",
        reasoning: "model reasoning",
        usage: null,
        finishReason: "stop",
        imageUrls: [],
        audioBase64: "",
        audioTranscript: "",
        toolCalls: [],
        annotations: [],
        generationId: null,
      };
    },
  });

  const result = await runParticipantTurn({
    ...buildParams({
      ctx,
      moderatorConfig: {
        modelId: "mod_1",
        displayName: "Moderator",
      },
    }),
  }, deps);

  assert.deepEqual(result, { kind: "completed", messageId: "msg_new" });
  assert.equal((requestInputs[0] as any).memoryContext, "resolved memory");
  assert.match(String((requestInputs[0] as any).systemPrompt), /Challenge weak assumptions/);
  assert.deepEqual(gateCalls[0], [
    {
      temperature: 0.6,
      maxTokens: 400,
      includeReasoning: true,
      reasoningEffort: "high",
      webSearchEnabled: true,
    },
    ["reasoning"],
    undefined,
    true,
  ]);
  assert.deepEqual(streamCalls[0]?.params, {
    temperature: 0.2,
    includeReasoning: true,
  });
  assert.deepEqual(mutations.filter((entry) => entry.status === "completed")[0], {
    messageId: "msg_new",
    jobId: "job_new",
    chatId: "chat_1",
    content: "Model returned reasoning only.",
    status: "completed",
    usage: undefined,
    reasoning: "model reasoning",
    imageUrls: undefined,
    userId: "user_1",
  });
  assert.equal(
    mutations.some((entry) => entry.chatId === "chat_1" && entry.messageId === "msg_new"),
    true,
  );
  assert.equal(
    mutations.some((entry) => entry.sessionId === "session_1" && Array.isArray(entry.parentMessageIds)),
    true,
  );
});

test("runParticipantTurn skips empty model output without images and cleans up created entities", async () => {
  const { ctx, mutations } = createAutonomousCtx();
  const deps = createRunParticipantTurnDepsForTest({
    getRequiredUserOpenRouterApiKey: async () => "key",
    loadMemoryContext: async () => undefined,
    buildRequestMessages: () => [{ role: "user", content: "Hello" }],
    promoteLatestUserVideoUrls: (messages: any) => ({ messages, events: [] }),
    gateParameters: () => ({}),
    createStreamWriter: () => ({
      handleContentDeltaBoundary: async () => undefined,
      appendContent: async () => undefined,
      patchContentIfNeeded: async () => undefined,
      appendReasoning: async () => undefined,
      patchReasoningIfNeeded: async () => undefined,
      flush: async () => undefined,
      totalReasoning: "",
      hasSeenContentDelta: false,
    }) as any,
    callOpenRouterStreaming: async () => ({
      content: "   ",
      reasoning: "",
      usage: null,
      finishReason: "stop",
      imageUrls: [],
      audioBase64: "",
      audioTranscript: "",
      toolCalls: [],
      annotations: [],
      generationId: null,
    }),
  });

  const result = await runParticipantTurn({
    ...buildParams(),
    ctx,
  }, deps);

  assert.deepEqual(result, { kind: "skipped" });
  assert.equal(
    mutations.some((entry) => entry.status === "completed"),
    false,
  );
  assert.equal(
    mutations.some((entry) => entry.messageId === "msg_new" && !("content" in entry)),
    true,
  );
});

test("runParticipantTurn marks message and job cancelled when a turn is cancelled mid-stream", async () => {
  const { ctx, mutations } = createAutonomousCtx();
  let cancellationChecks = 0;

  const deps = createRunParticipantTurnDepsForTest({
    getRequiredUserOpenRouterApiKey: async () => "key",
    loadMemoryContext: async () => undefined,
    buildRequestMessages: () => [{ role: "user", content: "Hello" }],
    promoteLatestUserVideoUrls: (messages: any) => ({ messages, events: [] }),
    gateParameters: () => ({}),
    createStreamWriter: (options) => ({
      handleContentDeltaBoundary: async () => undefined,
      appendContent: async () => undefined,
      patchContentIfNeeded: async () => {
        await options.beforePatch?.();
        await options.beforePatch?.();
      },
      appendReasoning: async () => undefined,
      patchReasoningIfNeeded: async () => undefined,
      flush: async () => undefined,
      totalReasoning: "",
      hasSeenContentDelta: false,
    }) as any,
    callOpenRouterStreaming: async (_apiKey, _model, _messages, _params, callbacks) => {
      await callbacks.onDelta?.("hello");
      return {
        content: "never reached",
        reasoning: "",
        usage: null,
        finishReason: "stop",
        imageUrls: [],
        audioBase64: "",
        audioTranscript: "",
        toolCalls: [],
        annotations: [],
        generationId: null,
      };
    },
  });

  const cancellingCtx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.chatId) return [{ _id: "msg_existing", role: "user", content: "hello" }];
      // isJobCancelled (now an internalQuery)
      if (Object.keys(args).length === 1 && args.jobId === "job_new") {
        cancellationChecks += 1;
        return cancellationChecks > 1;
      }
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (args.chatId && args.modelId && args.parentMessageIds) return "msg_new";
      if (args.chatId && args.modelId && args.messageId === "msg_new" && args.userId) return "job_new";
      return undefined;
    },
  });

  const result = await runParticipantTurn({
    ...buildParams(),
    ctx: cancellingCtx,
  }, deps);

  assert.deepEqual(result, { kind: "cancelled" });
  assert.equal(
    mutations.some((entry) => entry.jobId === "job_new" && entry.status === "cancelled"),
    true,
  );
  assert.equal(
    mutations.some((entry) => entry.messageId === "msg_new" && entry.status === "cancelled"),
    true,
  );
});
