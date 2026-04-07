import assert from "node:assert/strict";
import test from "node:test";

import {
  applySSEEventResult,
  finalizeToolCalls,
} from "../lib/openrouter_sse_apply";
import {
  processSSEBodyStream,
  processSSETextStream,
} from "../lib/openrouter_sse_stream_handlers";
import { SSEAccumulator } from "../lib/openrouter_sse_types";

function createAccumulator(): SSEAccumulator {
  return {
    content: "",
    reasoning: "",
    usage: null,
    finishReason: null,
    imageUrls: [],
    audioChunks: [],
    audioTranscript: "",
    toolCallsInProgress: new Map<number, { id: string; name: string; arguments: string }>(),
    toolCalls: [],
    annotations: [],
    generationId: null,
  };
}

test("finalizeToolCalls orders assembled tool calls by index", () => {
  const state = createAccumulator();
  state.toolCallsInProgress.set(2, {
    id: "call_2",
    name: "second",
    arguments: "{\"b\":2}",
  });
  state.toolCallsInProgress.set(0, {
    id: "call_0",
    name: "first",
    arguments: "{\"a\":1}",
  });

  finalizeToolCalls(state);

  assert.deepEqual(state.toolCalls, [
    {
      id: "call_0",
      type: "function",
      function: { name: "first", arguments: "{\"a\":1}" },
    },
    {
      id: "call_2",
      type: "function",
      function: { name: "second", arguments: "{\"b\":2}" },
    },
  ]);
});

test("applySSEEventResult accumulates deltas, freezes tool calls on done, and keeps the first generation id", async () => {
  const state = createAccumulator();
  const contentDeltas: string[] = [];
  const reasoningDeltas: string[] = [];

  const shouldCancel = await applySSEEventResult(
    {
      contentDelta: "Hello",
      reasoningDelta: "Think",
      audioDelta: "QU",
      audioTranscriptDelta: "Hi",
      toolCallDeltas: [
        {
          index: 1,
          id: "call_1",
          function: { name: "sum", arguments: "{\"a\":1" },
        },
      ],
      annotations: [
        {
          type: "url_citation",
          url_citation: { url: "https://example.com/source" },
        } as any,
      ],
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      finishReason: "tool_calls",
      imageUrls: ["https://cdn.example/image.png"],
      generationId: "gen_1",
    },
    state as any,
    {
      onDelta: async (delta) => {
        contentDeltas.push(delta);
      },
      onReasoningDelta: async (delta) => {
        reasoningDeltas.push(delta);
      },
    },
  );

  assert.equal(shouldCancel, false);

  await applySSEEventResult(
    {
      toolCallDeltas: [
        {
          index: 1,
          function: { name: "Numbers", arguments: ",\"b\":2}" },
        },
        {
          index: 0,
          id: "call_0",
          function: { name: "lookup", arguments: "{\"q\":\"x\"}" },
        },
      ],
      generationId: "gen_2",
      done: true,
      terminal: true,
    },
    state as any,
    {},
  );

  assert.deepEqual(contentDeltas, ["Hello"]);
  assert.deepEqual(reasoningDeltas, ["Think"]);
  assert.equal(state.content, "Hello");
  assert.equal(state.reasoning, "Think");
  assert.deepEqual(state.audioChunks, ["QU"]);
  assert.equal(state.audioTranscript, "Hi");
  assert.equal(state.finishReason, "tool_calls");
  assert.deepEqual(state.usage, {
    promptTokens: 1,
    completionTokens: 2,
    totalTokens: 3,
  });
  assert.deepEqual(state.imageUrls, ["https://cdn.example/image.png"]);
  assert.equal(state.generationId, "gen_1");
  assert.equal(state.toolCalls[0]?.function.name, "lookup");
  assert.equal(state.toolCalls[1]?.function.name, "sumNumbers");
  assert.equal(state.toolCalls[1]?.function.arguments, "{\"a\":1,\"b\":2}");
  assert.equal(state.annotations.length, 1);
});

test("applySSEEventResult throws stream errors", async () => {
  await assert.rejects(
    () =>
      applySSEEventResult(
        { error: "upstream failed" },
        createAccumulator() as any,
        {},
      ),
    /OpenRouter stream error: upstream failed/,
  );
});

test("processSSEBodyStream parses chunked SSE payloads and stops at the terminal event", async () => {
  let activityCount = 0;
  const contentDeltas: string[] = [];
  const reasoningDeltas: string[] = [];
  const firstEvent = JSON.stringify({
    choices: [{
      delta: {
        reasoning: "Think",
        content: "Hel",
        tool_calls: [{
          index: 1,
          id: "call_1",
          function: { name: "sum", arguments: "{\"a\":1" },
        }],
        annotations: [{
          type: "url_citation",
          url_citation: { url: "https://example.com/source" },
        }],
      },
    }],
    id: "gen_1",
  });
  const secondEvent = JSON.stringify({
    choices: [{
      delta: {
        content: "lo",
        audio: { data: "QU", transcript: "Hi" },
        tool_calls: [
          {
            index: 0,
            id: "call_0",
            function: { name: "lookup", arguments: "{\"q\":\"x\"}" },
          },
          {
            index: 1,
            function: { name: "Numbers", arguments: ",\"b\":2}" },
          },
        ],
        images: "https://cdn.example/image.png",
      },
      finish_reason: "tool_calls",
    }],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    id: "gen_2",
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          [
            ": keep-alive\r\n",
            `data: ${firstEvent}\r\n\r\n`,
            `data: ${secondEvent}\n\n`,
            "data: [DONE]\n\n",
          ].join(""),
        ),
      );
      controller.close();
    },
  });

  const result = await processSSEBodyStream(
    stream,
    {
      onDelta: async (delta) => {
        contentDeltas.push(delta);
      },
      onReasoningDelta: async (delta) => {
        reasoningDeltas.push(delta);
      },
    },
    () => {
      activityCount += 1;
    },
  );

  assert.equal(activityCount, 1);
  assert.deepEqual(contentDeltas, ["Hel", "lo"]);
  assert.deepEqual(reasoningDeltas, ["Think"]);
  assert.equal(result.content, "Hello");
  assert.equal(result.reasoning, "Think");
  assert.equal(result.audioBase64, "QU");
  assert.equal(result.audioTranscript, "Hi");
  assert.equal(result.finishReason, "tool_calls");
  assert.deepEqual(result.usage, {
    promptTokens: 1,
    completionTokens: 2,
    totalTokens: 3,
  });
  assert.deepEqual(result.imageUrls, ["https://cdn.example/image.png"]);
  assert.equal(result.generationId, "gen_1");
  assert.equal(result.toolCalls[0]?.function.name, "lookup");
  assert.equal(result.toolCalls[1]?.function.name, "sumNumbers");
  assert.equal(result.annotations.length, 1);
});

test("processSSETextStream ignores events after [DONE]", async () => {
  const result = await processSSETextStream(
    [
      "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}",
      "",
      "data: [DONE]",
      "",
      "data: {\"choices\":[{\"delta\":{\"content\":\"ignored\"}}]}",
      "",
    ].join("\n"),
    {},
  );

  assert.equal(result.content, "Hello");
});
