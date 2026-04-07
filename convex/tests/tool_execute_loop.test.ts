import assert from "node:assert/strict";
import test from "node:test";

import type { StreamResult, ToolCall } from "../lib/openrouter_types";
import { createToolCallLoopDepsForTest, runToolCallLoop } from "../tools/execute_loop";
import { createTool, ToolRegistry } from "../tools/registry";

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

function makeToolCall(
  id: string,
  name: string,
  args: Record<string, unknown>,
): ToolCall {
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

test("runToolCallLoop returns immediately when the initial result has no tool calls", async () => {
  let streamCalls = 0;
  const deps = createToolCallLoopDepsForTest({
    callOpenRouterStreaming: async () => {
      streamCalls += 1;
      return makeStreamResult();
    },
  });

  const registry = new ToolRegistry();
  const initial = makeStreamResult({ content: "hello", finishReason: "stop" });
  const result = await runToolCallLoop(initial, {
    apiKey: "key",
    model: "model",
    messages: [{ role: "user", content: "hi" }],
    params: {},
    callbacks: {},
    registry,
    toolCtx: { ctx: {} as any, userId: "user_1" },
  }, deps);

  assert.equal(streamCalls, 0);
  assert.equal(result.streamResult.content, "hello");
  assert.deepEqual(result.conversationMessages, [{ role: "user", content: "hi" }]);
});

test("runToolCallLoop executes multi-round tool recursion and applies next-turn params", async () => {
  const registry = new ToolRegistry();
  registry.register(
    createTool({
      name: "tool_one",
      description: "tool one",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ success: true, data: { ok: 1 } }),
    }),
    createTool({
      name: "tool_two",
      description: "tool two",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ success: true, data: { ok: 2 } }),
    }),
  );

  let streamCalls = 0;
  const deps = createToolCallLoopDepsForTest({
    callOpenRouterStreaming: async (
      _apiKey: unknown,
      _model: unknown,
      _messages: unknown,
      params: unknown,
    ) => {
      streamCalls += 1;
      if (streamCalls === 1 && (params as any).temperature === 0.4) {
        return makeStreamResult({
          finishReason: "tool_calls",
          toolCalls: [makeToolCall("call_2", "tool_two", { n: 2 })],
        });
      }
      return makeStreamResult({ content: "done", finishReason: "stop" });
    },
  });

  const rounds: string[] = [];
  const result = await runToolCallLoop(
    makeStreamResult({
      finishReason: "tool_calls",
      toolCalls: [makeToolCall("call_1", "tool_one", { n: 1 })],
    }),
    {
      apiKey: "key",
      model: "model",
      messages: [{ role: "user", content: "hi" }],
      params: { temperature: 0.2, webSearchEnabled: true },
      callbacks: {},
      registry,
      toolCtx: { ctx: {} as any, userId: "user_1" },
      onToolRoundStart: async (round) => {
        rounds.push(`start:${round}`);
      },
      onToolRoundComplete: async (round) => {
        rounds.push(`end:${round}`);
      },
      onPrepareNextTurn: async (round, _calls, _results, currentRegistry, currentParams) => {
        if (round === 1) {
          return {
            registry: currentRegistry,
            params: { ...currentParams, temperature: 0.4 },
          };
        }
      },
    },
    deps,
  );

  assert.deepEqual(rounds, ["start:1", "end:1", "start:2", "end:2"]);
  assert.equal(streamCalls, 2);
  assert.equal(result.streamResult.content, "done");
  assert.equal(result.allToolCalls.length, 2);
  assert.equal(result.allToolResults.length, 2);
  assert.equal(result.finalParams.temperature, 0.4);
});

test("runToolCallLoop captures deferred tool rounds without re-calling the model", async () => {
  const registry = new ToolRegistry();
  registry.register(
    createTool({
      name: "spawn_subagents",
      description: "spawn",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        success: true,
        data: { accepted: true },
        deferred: { kind: "spawn_subagents", data: { jobIds: ["child_1"] } },
      }),
    }),
  );

  let streamCalls = 0;
  const deps = createToolCallLoopDepsForTest({
    callOpenRouterStreaming: async () => {
      streamCalls += 1;
      return makeStreamResult();
    },
  });

  const result = await runToolCallLoop(
    makeStreamResult({
      finishReason: "tool_calls",
      toolCalls: [makeToolCall("call_1", "spawn_subagents", {})],
    }),
    {
      apiKey: "key",
      model: "model",
      messages: [{ role: "user", content: "hi" }],
      params: {},
      callbacks: {},
      registry,
      toolCtx: { ctx: {} as any, userId: "user_1" },
    },
    deps,
  );

  assert.equal(streamCalls, 0);
  assert.equal(result.deferredToolRound?.deferredResults[0]?.toolName, "spawn_subagents");
  assert.equal(result.deferredToolRound?.resumeConversationMessages.length, 3);
});

test("runToolCallLoop supports early exit and truncates stored tool metadata", async () => {
  const registry = new ToolRegistry();
  registry.register(
    createTool({
      name: "big_tool",
      description: "big",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        success: true,
        data: { text: "x".repeat(5000) },
      }),
    }),
  );

  const deps = createToolCallLoopDepsForTest({
    callOpenRouterStreaming: async () =>
      makeStreamResult({
        finishReason: "tool_calls",
        toolCalls: [makeToolCall("call_2", "big_tool", { input: "again" })],
      }),
  });

  const result = await runToolCallLoop(
    makeStreamResult({
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "big_tool",
            arguments: JSON.stringify({ text: "y".repeat(5000) }),
          },
        },
      ],
    }),
    {
      apiKey: "key",
      model: "model",
      messages: [{ role: "user", content: "hi" }],
      params: {},
      callbacks: {},
      registry,
      toolCtx: { ctx: {} as any, userId: "user_1" },
      shouldExitLoop: async () => true,
    },
    deps,
  );

  assert.equal(result.exitedEarly, true);
  assert.match(result.allToolCalls[0]?.arguments ?? "", /\[truncated\]$/);
  assert.match(result.allToolResults[0]?.result ?? "", /\[truncated\]$/);
});
