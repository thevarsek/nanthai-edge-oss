import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  callOpenRouterStreaming,
  createOpenRouterStreamingDepsForTest,
} from "../lib/openrouter_stream";

function response(
  status: number,
  text: string,
  body: unknown = null,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    text: async () => text,
    body,
  } as Response;
}

function streamResult(content = "ok") {
  return {
    content,
    reasoning: "",
    usage: null,
    finishReason: "stop",
    imageUrls: [],
    audioBase64: "",
    audioTranscript: "",
    toolCalls: [],
    annotations: [],
    generationId: "gen_1",
  };
}

test("streaming transport retries 429 with retry-after before processing the recovered body stream", async () => {
  const sleeps: number[] = [];
  const seenCallbacks: string[] = [];
  let fetchCount = 0;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: recovered\n\n"));
      controller.close();
    },
  });

  const deps = createOpenRouterStreamingDepsForTest({
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    fetch: async () => {
      fetchCount += 1;
      return fetchCount === 1
        ? response(429, "rate limited", null, { "retry-after": "0" })
        : response(200, "", readable);
    },
    processSSEBodyStream: async (_body, callbacks, onActivity) => {
      if (onActivity) onActivity();
      if (callbacks.onDelta) await callbacks.onDelta("delta");
      if (callbacks.onReasoningDelta) await callbacks.onReasoningDelta("reason");
      if (callbacks.onToolCallStart) await callbacks.onToolCallStart({ index: 0, id: "call_1", name: "search" });
      if (callbacks.onGenerationId) await callbacks.onGenerationId("gen_1");
      return streamResult("body ok");
    },
  });

  const result = await callOpenRouterStreaming(
    "key",
    "openai/gpt-5",
    [{ role: "user", content: "hello" }],
    {},
    {
      onDelta: async (delta) => { seenCallbacks.push(delta); },
      onReasoningDelta: async (delta) => { seenCallbacks.push(delta); },
      onToolCallStart: async (toolCall) => { seenCallbacks.push(toolCall.name); },
      onGenerationId: async (generationId) => { seenCallbacks.push(generationId); },
    },
    {},
    deps,
  );

  assert.equal(fetchCount, 2);
  assert.deepEqual(sleeps, [1000]);
  assert.deepEqual(seenCallbacks, ["delta", "reason", "search", "gen_1"]);
  assert.equal(result.content, "body ok");
});

test("streaming transport strips unsupported parameters and retries once per normalized parameter", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  let fetchCount = 0;
  const deps = createOpenRouterStreamingDepsForTest({
    fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      fetchCount += 1;
      if (fetchCount === 1) {
        return response(400, "Unsupported parameter reasoning_effort");
      }
      return response(200, "data: ok", null);
    },
    processSSETextStream: async () => streamResult("stripped ok"),
  });

  const result = await callOpenRouterStreaming(
    "key",
    "openai/gpt-5",
    [{ role: "user", content: "hello" }],
    { reasoningEffort: "high", temperature: 0.2 },
    {},
    {},
    deps,
  );

  assert.equal(result.content, "stripped ok");
  assert.deepEqual(requestBodies[0]?.reasoning, { effort: "high" });
  assert.equal("reasoning" in requestBodies[1], false);
  assert.equal(requestBodies[1]?.temperature, 0.2);
});

test("streaming transport retries 404 no-endpoints responses without soft provider routing but preserves ZDR", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  let fetchCount = 0;
  const deps = createOpenRouterStreamingDepsForTest({
    fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      fetchCount += 1;
      if (fetchCount === 1) {
        return response(404, JSON.stringify({ error: { message: "No endpoints found for request" } }));
      }
      return response(200, "data: ok", null);
    },
    processSSETextStream: async () => streamResult("rerouted ok"),
  });

  const result = await callOpenRouterStreaming(
    "key",
    "openai/gpt-5",
    [{ role: "user", content: "hello" }],
    { provider: { only: ["openai"], zdr: true } },
    {},
    {},
    deps,
  );

  assert.equal(result.content, "rerouted ok");
  assert.deepEqual(requestBodies[0]?.provider, { sort: "latency", only: ["openai"], zdr: true });
  assert.deepEqual(requestBodies[1]?.provider, { zdr: true });
});

test("streaming transport preserves structured ConvexError failures for non-retryable upstream errors", async () => {
  const deps = createOpenRouterStreamingDepsForTest({
    fetch: async () => response(500, JSON.stringify({ error: { message: "provider exploded" } })),
  });

  await assert.rejects(
    () => callOpenRouterStreaming(
      "key",
      "openai/gpt-5",
      [{ role: "user", content: "hello" }],
      {},
      {},
      {},
      deps,
    ),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.message.includes("provider exploded");
    },
  );
});

test("streaming transport returns the final empty result after configured retries are exhausted", async () => {
  const sleeps: number[] = [];
  const requestBodies: Array<Record<string, unknown>> = [];
  let processCount = 0;
  const emptyResult = {
    content: "",
    reasoning: "",
    usage: null,
    finishReason: null,
    imageUrls: [],
    audioBase64: "",
    audioTranscript: "",
    toolCalls: [],
    annotations: [],
    generationId: null,
  };
  const deps = createOpenRouterStreamingDepsForTest({
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return response(200, "data: empty", null);
    },
    processSSETextStream: async () => {
      processCount += 1;
      return emptyResult;
    },
  });

  const result = await callOpenRouterStreaming(
    "key",
    "empty/model",
    [{ role: "user", content: "hello" }],
    {
      provider: { only: ["openai"] },
      tools: [{
        type: "function",
        function: {
          name: "search",
          description: "Search",
          parameters: { type: "object", properties: {} },
        },
      }],
    },
    {},
    { emptyStreamRetries: 1, emptyStreamBackoffs: [25] },
    deps,
  );

  assert.equal(processCount, 2);
  assert.deepEqual(sleeps, [25]);
  assert.equal(requestBodies.length, 2);
  assert.deepEqual(result, emptyResult);
});
