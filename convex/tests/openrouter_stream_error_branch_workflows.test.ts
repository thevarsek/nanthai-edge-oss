import assert from "node:assert/strict";
import test from "node:test";

import {
  callOpenRouterStreaming,
  createOpenRouterStreamingDepsForTest,
} from "../lib/openrouter_stream";

function response(status: number, text: string, body: unknown = null): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => text,
    body,
  } as unknown as Response;
}

function streamResult(content: string) {
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

test("streaming transport falls back to a configured model after empty primary retries", async () => {
  const requestedModels: string[] = [];
  let processed = 0;
  const deps = createOpenRouterStreamingDepsForTest({
    sleep: async () => {},
    fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestedModels.push(JSON.parse(String(init?.body)).model);
      return response(200, "data: response");
    },
    processSSETextStream: async () => {
      processed += 1;
      return processed === 1 ? emptyResult : streamResult("fallback answer");
    },
  });

  const result = await callOpenRouterStreaming(
    "key",
    "primary/model",
    [{ role: "user", content: "hello" }],
    { tools: [{ type: "web" } as any] },
    {},
    { emptyStreamRetries: 0, fallbackModel: "fallback/model" },
    deps,
  );

  assert.equal(result.content, "fallback answer");
  assert.deepEqual(requestedModels, ["primary/model", "fallback/model"]);
});

test("streaming transport retries transient fetch failures with structured causes", async () => {
  const sleeps: number[] = [];
  let fetchCount = 0;
  const deps = createOpenRouterStreamingDepsForTest({
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    fetch: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        throw { message: "fetch failed", cause: "connection closed before message completed" };
      }
      return response(200, "data: ok");
    },
    processSSETextStream: async () => streamResult("retried ok"),
  });

  const result = await callOpenRouterStreaming(
    "key",
    "openai/gpt-5",
    [{ role: "user", content: "hello" }],
    {},
    {},
    { networkRetries: 1, networkRetryDelayMs: 7 },
    deps,
  );

  assert.equal(result.content, "retried ok");
  assert.deepEqual(sleeps, [7]);
});

test("streaming transport switches fallback model after non-transient stream errors exhaust attempts", async () => {
  const requestedModels: string[] = [];
  let textCalls = 0;
  const deps = createOpenRouterStreamingDepsForTest({
    fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestedModels.push(JSON.parse(String(init?.body)).model);
      return response(200, "data: ok");
    },
    processSSETextStream: async () => {
      textCalls += 1;
      if (textCalls === 1) throw new Error("provider stream parser failed");
      return streamResult("fallback ok");
    },
  });

  const result = await callOpenRouterStreaming(
    "key",
    "primary/model",
    [{ role: "user", content: "hello" }],
    {},
    {},
    { emptyStreamRetries: 0, fallbackModel: "fallback/model" },
    deps,
  );

  assert.equal(result.content, "fallback ok");
  assert.deepEqual(requestedModels, ["primary/model", "fallback/model"]);
});

test("streaming transport preserves timeout context from AbortError-shaped failures", async () => {
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: start\n\n"));
      controller.close();
    },
  });
  const deps = createOpenRouterStreamingDepsForTest({
    fetch: async () => response(200, "", readable),
    processSSEBodyStream: async () => {
      throw { name: "AbortError", cause: "slow upstream" };
    },
  });

  await assert.rejects(
    () => callOpenRouterStreaming(
      "key",
      "openai/gpt-5",
      [{ role: "user", content: "hello" }],
      {},
      {},
      { networkRetries: 0 },
      deps,
    ),
    /OpenRouter stream timeout.*slow upstream/,
  );
});
