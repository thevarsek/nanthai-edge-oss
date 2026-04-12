import assert from "node:assert/strict";
import test from "node:test";

import type {
  OpenRouterMessage,
  OpenRouterUsage,
  StreamResult,
  ToolCall,
} from "../lib/openrouter_types";
import {
  createRunGenerationWithCompactionDepsForTest,
  runGenerationWithCompaction,
} from "../chat/actions_run_generation_loop";
import type { ToolCallLoopResult } from "../tools/execute_loop";

function makeUsage(promptTokens: number, completionTokens: number): OpenRouterUsage {
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function makeStreamResult(overrides: Partial<StreamResult> = {}): StreamResult {
  return {
    content: "",
    reasoning: "",
    usage: null,
    finishReason: "stop",
    imageUrls: [],
    audioBase64: "",
    audioTranscript: "",
    toolCalls: [],
    annotations: [],
    generationId: null,
    ...overrides,
  };
}

function makeToolCall(id: string, name: string): ToolCall {
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: "{}",
    },
  };
}

function makeLoopResult(overrides: Partial<ToolCallLoopResult> = {}): ToolCallLoopResult {
  return {
    streamResult: makeStreamResult(),
    exitedEarly: false,
    allToolCalls: [],
    allToolResults: [],
    conversationMessages: [{ role: "user", content: "hi" }],
    finalRegistry: { isEmpty: false } as any,
    finalParams: {},
    ...overrides,
  };
}

test("runGenerationWithCompaction returns immediately on simple non-tool responses", async () => {
  let toolLoopCalls = 0;
  const deps = createRunGenerationWithCompactionDepsForTest({
    callOpenRouterStreaming: async () =>
      makeStreamResult({
        content: "done",
        finishReason: "stop",
        usage: makeUsage(10, 5),
      }),
    runToolCallLoop: async () => {
      toolLoopCalls += 1;
      return makeLoopResult();
    },
  });

  const result = await runGenerationWithCompaction({
    apiKey: "key",
    model: "model",
    messages: [{ role: "user", content: "hi" }],
    params: {},
    callbacks: {},
    toolCtx: { ctx: {} as any, userId: "user_1" },
    modelContextLimit: 100,
    writer: {
      patchReasoningIfNeeded: async () => undefined,
      flush: async () => undefined,
    } as any,
    actionStartTime: 0,
  }, deps);

  assert.equal(toolLoopCalls, 0);
  assert.equal(result.streamResult.content, "done");
  assert.deepEqual(result.totalUsage, makeUsage(10, 5));
  assert.equal(result.compactionCount, 0);
});

test("runGenerationWithCompaction compacts overflowing tool loops and aggregates usage and tool metadata", async () => {
  const streamCalls: OpenRouterMessage[][] = [];
  const loopInputs: string[] = [];
  let patchReasoningCalls = 0;
  let flushCalls = 0;

  const deps = createRunGenerationWithCompactionDepsForTest({
    callOpenRouterStreaming: async (_apiKey: string, _model: string, messages: OpenRouterMessage[]) => {
      streamCalls.push(messages);
      if (streamCalls.length === 1) {
        return makeStreamResult({
          finishReason: "tool_calls",
          toolCalls: [makeToolCall("call_1", "search")],
          usage: makeUsage(30, 5),
        });
      }
      return makeStreamResult({
        content: "final answer",
        finishReason: "stop",
        usage: makeUsage(12, 8),
      });
    },
    runToolCallLoop: async (_initial, options) => {
      loopInputs.push(String(options.params.webSearchEnabled));
      return makeLoopResult({
        exitedEarly: true,
        streamResult: makeStreamResult({
          finishReason: "tool_calls",
          toolCalls: [makeToolCall("call_2", "calendar")],
          usage: makeUsage(90, 4),
        }),
        allToolCalls: [{ id: "call_2", name: "calendar", arguments: "{}" }],
        allToolResults: [{ toolCallId: "call_2", toolName: "calendar", result: "{\"ok\":true}" }],
        conversationMessages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: null, tool_calls: [makeToolCall("call_2", "calendar")] },
          { role: "tool", tool_call_id: "call_2", content: "{\"ok\":true}" },
        ],
        finalRegistry: { isEmpty: false } as any,
        finalParams: { temperature: 0.4, webSearchEnabled: true },
      });
    },
    isContextOverflow: (promptTokens: number) => promptTokens >= 90,
    isApproachingTimeout: () => false,
    pruneToolOutputs: (messages: OpenRouterMessage[]) => ({
      messages,
      tokensSaved: 0,
    }),
    compactMessages: async () => ({
      summary: "condensed context",
      usage: makeUsage(4, 1),
      generationId: "compact_1",
      modelId: "compact-model",
    }),
    buildCompactedMessages: () => [
      { role: "system", content: "system" },
      { role: "assistant", content: "summary" },
      { role: "user", content: "hi again" },
    ],
  });

  const result = await runGenerationWithCompaction({
    apiKey: "key",
    model: "model",
    messages: [{ role: "user", content: "hi" }],
    params: { webSearchEnabled: true },
    callbacks: {},
    toolRegistry: { isEmpty: false } as any,
    toolCtx: { ctx: {} as any, userId: "user_1" },
    modelContextLimit: 100,
    writer: {
      patchReasoningIfNeeded: async (force: boolean) => {
        patchReasoningCalls += force ? 1 : 0;
      },
      flush: async () => {
        flushCalls += 1;
      },
    } as any,
    actionStartTime: 0,
  }, deps);

  assert.deepEqual(loopInputs, ["false"]);
  assert.equal(patchReasoningCalls, 1);
  assert.equal(flushCalls, 1);
  assert.equal(streamCalls.length, 2);
  assert.deepEqual(streamCalls[1], [
    { role: "system", content: "system" },
    { role: "assistant", content: "summary" },
    { role: "user", content: "hi again" },
  ]);
  assert.equal(result.streamResult.content, "final answer");
  assert.equal(result.totalUsage?.promptTokens, 132);
  assert.equal(result.totalUsage?.completionTokens, 17);
  assert.equal(result.totalUsage?.totalTokens, 149);
  assert.deepEqual(result.allToolCalls, [
    { id: "call_2", name: "calendar", arguments: "{}" },
  ]);
  assert.deepEqual(result.compactionUsages, [{
    usage: makeUsage(4, 1),
    generationId: "compact_1",
    modelId: "compact-model",
  }]);
});

test("runGenerationWithCompaction returns a continuation handoff when timeout compaction is allowed", async () => {
  const deps = createRunGenerationWithCompactionDepsForTest({
    callOpenRouterStreaming: async () =>
      makeStreamResult({
        finishReason: "tool_calls",
        toolCalls: [makeToolCall("call_1", "search")],
        usage: makeUsage(10, 1),
      }),
    runToolCallLoop: async () =>
      makeLoopResult({
        exitedEarly: true,
        streamResult: makeStreamResult({
          finishReason: "tool_calls",
          toolCalls: [makeToolCall("call_2", "search")],
          usage: makeUsage(10, 1),
        }),
      }),
    isContextOverflow: () => false,
    isApproachingTimeout: () => true,
    pruneToolOutputs: (messages: OpenRouterMessage[]) => ({
      messages,
      tokensSaved: 0,
    }),
    compactMessages: async () => ({
      summary: "timeout summary",
      usage: null,
      generationId: null,
      modelId: "compact-model",
    }),
    buildCompactedMessages: () => [{ role: "assistant", content: "timeout summary" }],
  });

  const result = await runGenerationWithCompaction({
    apiKey: "key",
    model: "model",
    messages: [{ role: "user", content: "hi" }],
    params: {},
    callbacks: {},
    toolRegistry: { isEmpty: false } as any,
    toolCtx: { ctx: {} as any, userId: "user_1" },
    modelContextLimit: 100,
    writer: {
      patchReasoningIfNeeded: async () => undefined,
      flush: async () => undefined,
    } as any,
    actionStartTime: 0,
    allowContinuationHandoff: true,
  }, deps);

  assert.deepEqual(result.continuation, {
    reason: "timeout",
    messages: [{ role: "assistant", content: "timeout summary" }],
  });
});

test("runGenerationWithCompaction returns a round-budget continuation without compaction", async () => {
  let compactCalls = 0;
  const deps = createRunGenerationWithCompactionDepsForTest({
    callOpenRouterStreaming: async () =>
      makeStreamResult({
        finishReason: "tool_calls",
        toolCalls: [makeToolCall("call_1", "search")],
        usage: makeUsage(10, 1),
      }),
    runToolCallLoop: async () =>
      makeLoopResult({
        exitedEarly: true,
        exitReason: "round_budget",
        streamResult: makeStreamResult({
          finishReason: "tool_calls",
          toolCalls: [makeToolCall("call_2", "search")],
          usage: makeUsage(10, 1),
        }),
        conversationMessages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: null, tool_calls: [makeToolCall("call_1", "search")] },
          { role: "tool", tool_call_id: "call_1", content: "{\"ok\":true}" },
        ],
      }),
    compactMessages: async () => {
      compactCalls += 1;
      return {
        summary: "unused",
        usage: null,
        generationId: null,
        modelId: "compact-model",
      };
    },
  });

  const result = await runGenerationWithCompaction({
    apiKey: "key",
    model: "model",
    messages: [{ role: "user", content: "hi" }],
    params: {},
    callbacks: {},
    toolRegistry: { isEmpty: false } as any,
    toolCtx: { ctx: {} as any, userId: "user_1" },
    modelContextLimit: 100,
    writer: {
      patchReasoningIfNeeded: async () => undefined,
      flush: async () => undefined,
    } as any,
    actionStartTime: 0,
    allowContinuationHandoff: true,
    maxToolRoundsPerInvocation: 1,
  }, deps);

  assert.equal(compactCalls, 0);
  assert.deepEqual(result.continuation, {
    reason: "round_budget",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: null, tool_calls: [makeToolCall("call_1", "search")] },
      { role: "tool", tool_call_id: "call_1", content: "{\"ok\":true}" },
    ],
  });
});

test("runGenerationWithCompaction forces a final text response after the continuation cap", async () => {
  const seenParams: Array<Record<string, unknown>> = [];
  const deps = createRunGenerationWithCompactionDepsForTest({
    callOpenRouterStreaming: async (_apiKey: string, _model: string, _messages: OpenRouterMessage[], params) => {
      seenParams.push(params as Record<string, unknown>);
      if (seenParams.length === 1) {
        return makeStreamResult({
          finishReason: "tool_calls",
          toolCalls: [makeToolCall("call_1", "search")],
          usage: makeUsage(10, 1),
        });
      }
      return makeStreamResult({
        content: "forced final",
        finishReason: "stop",
        usage: makeUsage(3, 2),
      });
    },
    runToolCallLoop: async () =>
      makeLoopResult({
        exitedEarly: true,
        streamResult: makeStreamResult({
          finishReason: "tool_calls",
          toolCalls: [makeToolCall("call_2", "search")],
          usage: makeUsage(10, 1),
        }),
        conversationMessages: [{ role: "tool", content: "result" }],
        finalParams: { temperature: 0.5, webSearchEnabled: true },
      }),
    isContextOverflow: () => false,
    isApproachingTimeout: () => true,
  });

  const result = await runGenerationWithCompaction({
    apiKey: "key",
    model: "model",
    messages: [{ role: "user", content: "hi" }],
    params: { webSearchEnabled: true, temperature: 0.5 },
    callbacks: {},
    toolRegistry: { isEmpty: false } as any,
    toolCtx: { ctx: {} as any, userId: "user_1" },
    modelContextLimit: 100,
    writer: {
      patchReasoningIfNeeded: async () => undefined,
      flush: async () => undefined,
    } as any,
    actionStartTime: 0,
    initialCompactionCount: 5,
  }, deps);

  assert.equal(result.streamResult.content, "forced final");
  assert.equal(seenParams.length, 2);
  assert.deepEqual(seenParams[1], {
    temperature: 0.5,
    webSearchEnabled: false,
    toolChoice: "none",
  });
});
