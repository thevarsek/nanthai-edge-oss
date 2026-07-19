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
      effectPolicy: { effect: "read", retry: "safe" },
      description: "tool one",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ success: true, data: { ok: 1 } }),
    }),
    createTool({
      name: "tool_two",
      effectPolicy: { effect: "read", retry: "safe" },
      description: "tool two",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ success: true, data: { ok: 2 } }),
    }),
  );

  let streamCalls = 0;
  const streamedMessages: unknown[] = [];
  const deps = createToolCallLoopDepsForTest({
    callOpenRouterStreaming: async (
      _apiKey: unknown,
      _model: unknown,
      messages: unknown,
      params: unknown,
    ) => {
      streamCalls += 1;
      streamedMessages.push(messages);
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
  const artifactRounds: Array<{ round: number; callCount: number; resultCount: number }> = [];
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
      onToolArtifacts: async (round, toolCalls, results) => {
        artifactRounds.push({ round, callCount: toolCalls.length, resultCount: results.length });
      },
      onPrepareNextTurn: async (
        round,
        _calls,
        _results,
        conversationMessages,
        currentRegistry,
        currentParams,
      ) => {
        if (round === 1) {
          return {
            registry: currentRegistry,
            params: { ...currentParams, temperature: 0.4 },
            messages: [...conversationMessages, { role: "system", content: "normalized" }],
          };
        }
      },
    },
    deps,
  );

  assert.deepEqual(rounds, ["start:1", "end:1", "start:2", "end:2"]);
  assert.deepEqual(artifactRounds, [
    { round: 1, callCount: 1, resultCount: 1 },
    { round: 2, callCount: 1, resultCount: 1 },
  ]);
  assert.equal(streamCalls, 2);
  assert.equal(result.streamResult.content, "done");
  assert.equal(result.allToolCalls.length, 2);
  assert.equal(result.allToolResults.length, 2);
  assert.equal(result.finalParams.temperature, 0.4);
  assert.deepEqual(streamedMessages[0], [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: null,
      tool_calls: [makeToolCall("call_1", "tool_one", { n: 1 })],
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: JSON.stringify({ ok: 1 }),
    },
    { role: "system", content: "normalized" },
  ]);
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

test("runToolCallLoop preserves pre-round baseConversationMessages when next-turn messages are rewritten", async () => {
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
      onPrepareNextTurn: async (_round, _calls, _results, conversationMessages) => ({
        messages: [
          ...conversationMessages,
          { role: "system", content: "normalized loaded skills" },
        ],
      }),
    },
  );

  assert.deepEqual(result.deferredToolRound?.baseConversationMessages, [
    { role: "user", content: "hi" },
  ]);
  assert.deepEqual(result.deferredToolRound?.resumeConversationMessages, [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: null,
      tool_calls: [makeToolCall("call_1", "spawn_subagents", {})],
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: JSON.stringify({ accepted: true }),
    },
    { role: "system", content: "normalized loaded skills" },
  ]);
});

test("runToolCallLoop supports early exit and truncates stored tool metadata", async () => {
  const registry = new ToolRegistry();
  registry.register(
    createTool({
      name: "big_tool",
      effectPolicy: { effect: "read", retry: "safe" },
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

test("runToolCallLoop exits after the configured round budget before the next model call", async () => {
  const registry = new ToolRegistry();
  registry.register(
    createTool({
      name: "one_round_tool",
      effectPolicy: { effect: "read", retry: "safe" },
      description: "single round",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ success: true, data: { ok: true } }),
    }),
  );

  let streamCalls = 0;
  const deps = createToolCallLoopDepsForTest({
    callOpenRouterStreaming: async () => {
      streamCalls += 1;
      return makeStreamResult({ content: "should not happen" });
    },
  });

  const result = await runToolCallLoop(
    makeStreamResult({
      finishReason: "tool_calls",
      toolCalls: [makeToolCall("call_1", "one_round_tool", {})],
    }),
    {
      apiKey: "key",
      model: "model",
      messages: [{ role: "user", content: "hi" }],
      params: {},
      callbacks: {},
      registry,
      toolCtx: { ctx: {} as any, userId: "user_1" },
      maxRoundsPerInvocation: 1,
    },
    deps,
  );

  assert.equal(streamCalls, 0);
  assert.equal(result.exitedEarly, true);
  assert.equal(result.exitReason, "round_budget");
  assert.equal(result.conversationMessages.length, 3);
});

test("runToolCallLoop allows two invocation rounds before continuation handoff", async () => {
  const registry = new ToolRegistry();
  registry.register(
    createTool({
      name: "runtime_safe_tool",
      effectPolicy: { effect: "read", retry: "safe" },
      description: "runtime safe",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ success: true, data: { ok: true } }),
    }),
  );

  let streamCalls = 0;
  const deps = createToolCallLoopDepsForTest({
    callOpenRouterStreaming: async () => {
      streamCalls += 1;
      return makeStreamResult({
        finishReason: "tool_calls",
        toolCalls: [makeToolCall("call_2", "runtime_safe_tool", {})],
      });
    },
  });

  const result = await runToolCallLoop(
    makeStreamResult({
      finishReason: "tool_calls",
      toolCalls: [makeToolCall("call_1", "runtime_safe_tool", {})],
    }),
    {
      apiKey: "key",
      model: "model",
      messages: [{ role: "user", content: "hi" }],
      params: {},
      callbacks: {},
      registry,
      toolCtx: { ctx: {} as any, userId: "user_1" },
      maxRoundsPerInvocation: 2,
    },
    deps,
  );

  assert.equal(streamCalls, 1);
  assert.equal(result.exitedEarly, true);
  assert.equal(result.exitReason, "round_budget");
  assert.equal(result.allToolCalls.length, 2);
});

test("runToolCallLoop can stop after a tool round before the next model call", async () => {
  const registry = new ToolRegistry();
  registry.register(
    createTool({
      name: "load_skill",
      description: "load skill",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        success: true,
        data: { activeProfiles: ["google"] },
      }),
    }),
  );

  let streamCalls = 0;
  const deps = createToolCallLoopDepsForTest({
    callOpenRouterStreaming: async () => {
      streamCalls += 1;
      return makeStreamResult({ content: "should not happen" });
    },
  });

  const result = await runToolCallLoop(
    makeStreamResult({
      finishReason: "tool_calls",
      toolCalls: [makeToolCall("call_1", "load_skill", { skill: "gmail" })],
    }),
    {
      apiKey: "key",
      model: "model",
      messages: [{ role: "user", content: "hi" }],
      params: {},
      callbacks: {},
      registry,
      toolCtx: { ctx: {} as any, userId: "user_1" },
      onPrepareNextTurn: async () => ({ stopBeforeModelCall: true }),
      maxRoundsPerInvocation: 2,
    },
    deps,
  );

  assert.equal(streamCalls, 0);
  assert.equal(result.exitedEarly, true);
  assert.equal(result.exitReason, "round_budget");
});

test("runToolCallLoop suppresses only a repeated successful skill load", async () => {
  const registry = new ToolRegistry();
  let loadCalls = 0;
  let editCalls = 0;
  registry.register(
    createTool({
      name: "load_skill",
      description: "load skill",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        loadCalls += 1;
        return { success: true, data: { skill: "pptx" } };
      },
    }),
    createTool({
      name: "edit_presentation",
      description: "edit presentation",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        editCalls += 1;
        return { success: true, data: { edited: true } };
      },
    }),
  );

  const requestedToolNames: string[][] = [];
  let streamCalls = 0;
  const deps = createToolCallLoopDepsForTest({
    callOpenRouterStreaming: async (_apiKey, _model, _messages, params) => {
      streamCalls += 1;
      requestedToolNames.push((params.tools ?? []).flatMap((tool) =>
        "function" in tool ? [tool.function.name] : []
      ));
      if (streamCalls === 1) {
        return makeStreamResult({
          finishReason: "tool_calls",
          toolCalls: [makeToolCall("edit_1", "edit_presentation", { slideId: "s1" })],
        });
      }
      return makeStreamResult({ content: "done" });
    },
  });

  const result = await runToolCallLoop(
    makeStreamResult({
      finishReason: "tool_calls",
      toolCalls: [makeToolCall("load_again", "load_skill", { name: "pptx" })],
    }),
    {
      apiKey: "key",
      model: "model",
      messages: [{ role: "user", content: "edit it" }],
      params: { tools: registry.getDefinitions() },
      callbacks: {},
      registry,
      loadedSkillSlugs: ["pptx"],
      toolCtx: { ctx: {} as never, userId: "user_1" },
    },
    deps,
  );

  assert.equal(loadCalls, 0);
  assert.equal(editCalls, 1);
  assert.deepEqual(requestedToolNames[0], ["edit_presentation"]);
  assert.deepEqual(requestedToolNames[1], ["load_skill", "edit_presentation"]);
  assert.equal(result.streamResult.content, "done");
});

test("runToolCallLoop allows repeated presentation edits across tool rounds", async () => {
  const registry = new ToolRegistry();
  let editCalls = 0;
  registry.register(createTool({
    name: "edit_presentation",
    description: "edit presentation",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      editCalls += 1;
      return { success: true, data: { revision: editCalls } };
    },
  }));
  let streamCalls = 0;
  const deps = createToolCallLoopDepsForTest({
    callOpenRouterStreaming: async () => {
      streamCalls += 1;
      return streamCalls === 1
        ? makeStreamResult({
            finishReason: "tool_calls",
            toolCalls: [makeToolCall("edit_2", "edit_presentation", { slideId: "s1" })],
          })
        : makeStreamResult({ content: "done" });
    },
  });

  await runToolCallLoop(
    makeStreamResult({
      finishReason: "tool_calls",
      toolCalls: [makeToolCall("edit_1", "edit_presentation", { slideId: "s1" })],
    }),
    {
      apiKey: "key",
      model: "model",
      messages: [{ role: "user", content: "iterate" }],
      params: { tools: registry.getDefinitions() },
      callbacks: {},
      registry,
      toolCtx: { ctx: {} as never, userId: "user_1" },
    },
    deps,
  );

  assert.equal(editCalls, 2);
});
