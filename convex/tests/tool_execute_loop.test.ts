import assert from "node:assert/strict";
import test from "node:test";

import type { StreamResult, ToolCall } from "../lib/openrouter_types";
import { extractGeneratedToolMedia } from "../chat/generated_media_tool_results";
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

test("runToolCallLoop preserves partial integration results in the model transcript", async () => {
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: "outlook_create_draft",
    effectPolicy: { effect: "write", retry: "idempotency_key_required" },
    description: "Create an Outlook draft",
    parameters: { type: "object", properties: {} },
    execute: async () => ({
      success: false,
      error: "Draft created, but one attachment could not be added.",
      data: {
        draftId: "draft_1",
        attachedFileIds: ["file_1"],
        failedFileIds: ["file_2"],
      },
    }),
  }));
  let modelMessages: Array<{ role: string; content?: unknown; tool_call_id?: string }> = [];
  const deps = createToolCallLoopDepsForTest({
    callOpenRouterStreaming: async (_key, _model, messages) => {
      modelMessages = messages as typeof modelMessages;
      return makeStreamResult({ content: "I created the draft and reported the attachment issue." });
    },
  });

  const result = await runToolCallLoop(makeStreamResult({
    finishReason: "tool_calls",
    toolCalls: [makeToolCall("call_outlook", "outlook_create_draft", {})],
  }), {
    apiKey: "key",
    model: "model",
    messages: [{ role: "user", content: "Draft the email" }],
    params: {},
    callbacks: {},
    registry,
    toolCtx: {
      ctx: {} as any,
      userId: "user_1",
    },
  }, deps);

  const toolMessage = modelMessages.find((message) => message.tool_call_id === "call_outlook");
  const expectedPayload = {
    error: "Draft created, but one attachment could not be added.",
    draftId: "draft_1",
    attachedFileIds: ["file_1"],
    failedFileIds: ["file_2"],
  };
  assert.deepEqual(JSON.parse(String(toolMessage?.content)), expectedPayload);
  assert.deepEqual(JSON.parse(result.allToolResults[0]?.result ?? "null"), expectedPayload);
});

test("runToolCallLoop checkpoints same-round progressive retries with the authoritative context", async () => {
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: "load_skill",
    description: "load skill",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ success: true, data: { skill: "image-generation" } }),
  }));
  const callbackOrder: string[] = [];
  let artifactResult: unknown;
  let checkpointResult: unknown;

  const result = await runToolCallLoop(
    makeStreamResult({
      finishReason: "tool_calls",
      toolCalls: [
        makeToolCall("load_1", "load_skill", { skill: "image-generation" }),
        makeToolCall("image_1", "generate_image", { prompt: "a lake" }),
      ],
    }),
    {
      apiKey: "key",
      model: "model",
      messages: [{ role: "user", content: "create an image" }],
      params: {},
      callbacks: {},
      registry,
      toolCtx: {
        ctx: {} as never,
        userId: "user_1",
        providerDeadlineAtMs: 9_000,
        operationScope: "job_1:segment:3",
      },
      maxRoundsPerInvocation: 1,
      onPrepareNextTurn: async (
        _round,
        _calls,
        results,
        messages,
        _currentRegistry,
        _currentParams,
        roundToolCtx,
      ) => {
        callbackOrder.push("retry");
        assert.equal(roundToolCtx.providerDeadlineAtMs, 9_000);
        assert.equal(roundToolCtx.operationScope, "job_1:segment:3:round:1");
        const imageResult = results.find(({ toolCallId }) => toolCallId === "image_1");
        assert.ok(imageResult);
        imageResult.result = {
          success: true,
          data: { imageUrls: ["https://files.example/generated.png"] },
        };
        return {
          messages: [...messages, { role: "system", content: "skill loaded" }],
        };
      },
      onToolRoundComplete: async (_round, results) => {
        callbackOrder.push("checkpoint");
        checkpointResult = results.find(({ toolCallId }) => toolCallId === "image_1")?.result;
      },
      onToolArtifacts: async (_round, _calls, results) => {
        callbackOrder.push("artifact");
        artifactResult = results.find(({ toolCallId }) => toolCallId === "image_1")?.result;
      },
    },
  );

  assert.deepEqual(callbackOrder, ["retry", "checkpoint", "artifact"]);
  assert.deepEqual(checkpointResult, artifactResult);
  assert.deepEqual(checkpointResult, {
    success: true,
    data: { imageUrls: ["https://files.example/generated.png"] },
  });
  const imageMessage = result.conversationMessages.find(
    (message) => message.role === "tool" && message.tool_call_id === "image_1",
  );
  assert.equal(
    imageMessage?.content,
    JSON.stringify({ imageUrls: ["https://files.example/generated.png"] }),
  );
  assert.equal(result.allToolResults.find(({ toolCallId }) => toolCallId === "image_1")?.isError, undefined);
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

test("runToolCallLoop keeps long-prompt media ownership results valid and attachable", async () => {
  const registry = new ToolRegistry();
  registry.register(
    createTool({
      name: "generate_image",
      description: "image",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        success: true,
        data: {
          kind: "image",
          prompt: "i".repeat(5_000),
          requestedCount: 1,
          generatedCount: 1,
          images: [{
            storageId: "image_storage_1",
            url: "https://files.example/generated.png",
            mimeType: "image/png",
            sizeBytes: 42,
          }],
          imageUrls: ["https://files.example/generated.png"],
          imageMimeTypes: ["image/png"],
        },
      }),
    }),
    createTool({
      name: "generate_speech",
      description: "speech",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        success: true,
        data: {
          kind: "speech",
          prompt: "s".repeat(5_000),
          audioTranscript: "s".repeat(5_000),
          storageId: "audio_storage_1",
          generatedFileId: "generated_file_1",
          audioStorageId: "audio_storage_1",
          audioUrl: "https://files.example/generated.mp3",
          audioMimeType: "audio/mpeg",
          sizeBytes: 84,
        },
      }),
    }),
  );

  const result = await runToolCallLoop(
    makeStreamResult({
      finishReason: "tool_calls",
      toolCalls: [
        makeToolCall("image_call", "generate_image", {}),
        makeToolCall("speech_call", "generate_speech", {}),
      ],
    }),
    {
      apiKey: "key",
      model: "model",
      messages: [{ role: "user", content: "create media" }],
      params: {},
      callbacks: {},
      registry,
      toolCtx: { ctx: {} as any, userId: "user_1" },
      maxRoundsPerInvocation: 1,
    },
  );

  for (const toolResult of result.allToolResults) {
    assert.doesNotThrow(() => JSON.parse(toolResult.result));
    assert.ok(toolResult.result.length <= 4_000);
  }
  const media = extractGeneratedToolMedia(result.allToolResults);
  assert.deepEqual(media.imageUrls, ["https://files.example/generated.png"]);
  assert.equal(media.audio?.storageId, "audio_storage_1");
  assert.ok(media.audio?.transcript?.startsWith("s".repeat(100)));
  assert.ok((media.audio?.transcript?.length ?? 0) < 5_000);
  assert.deepEqual(media.generatedFileIds, ["generated_file_1"]);
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
