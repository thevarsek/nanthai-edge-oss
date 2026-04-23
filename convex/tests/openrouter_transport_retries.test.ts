import assert from "node:assert/strict";
import test from "node:test";

import {
  callOpenRouterNonStreaming,
  createOpenRouterNonStreamingDepsForTest,
} from "../lib/openrouter_nonstream";
import {
  callOpenRouterStreaming,
  createOpenRouterStreamingDepsForTest,
} from "../lib/openrouter_stream";

function jsonResponse(status: number, payload: unknown, extraHeaders: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => extraHeaders[name.toLowerCase()] ?? null,
    },
    text: async () => JSON.stringify(payload),
    body: null,
  };
}

function textResponse(status: number, text: string, body: unknown = null, extraHeaders: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => extraHeaders[name.toLowerCase()] ?? null,
    },
    text: async () => text,
    body,
  };
}

test("callOpenRouterNonStreaming retries 429 responses and eventually succeeds", async () => {
  const sleepCalls: number[] = [];
  let fetchCount = 0;

  const deps = createOpenRouterNonStreamingDepsForTest({
    sleep: async (ms: number) => {
      sleepCalls.push(ms);
    },
    fetch: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return textResponse(429, "rate limited", null, { "retry-after": "0" }) as any;
      }
      return jsonResponse(200, {
        id: "gen_1",
        choices: [{ message: { content: "done" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }) as any;
    },
  });

  const result = await callOpenRouterNonStreaming(
    "key",
    "openai/gpt-4.1",
    [{ role: "user", content: "hi" }],
    {},
    {},
    deps,
  );

  assert.equal(fetchCount, 2);
  assert.deepEqual(sleepCalls, [1000]);
  assert.equal(result.content, "done");
  assert.equal(result.generationId, "gen_1");
});

test("callOpenRouterNonStreaming strips unsupported params before retrying", async () => {
  const requestBodies: Record<string, unknown>[] = [];
  let fetchCount = 0;

  const deps = createOpenRouterNonStreamingDepsForTest({
    fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      fetchCount += 1;
      if (fetchCount === 1) {
        return textResponse(400, "Unsupported parameter reasoning_effort") as any;
      }
      return jsonResponse(200, {
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }) as any;
    },
  });

  const result = await callOpenRouterNonStreaming(
    "key",
    "openai/gpt-4.1",
    [{ role: "user", content: "hi" }],
    { reasoningEffort: "high", temperature: 0.5 },
    {},
    deps,
  );

  assert.equal(fetchCount, 2);
  assert.deepEqual(requestBodies[0]?.reasoning, { effort: "high" });
  assert.equal("reasoning" in requestBodies[1], false);
  assert.equal(requestBodies[1]?.temperature, 0.5);
  assert.equal(result.content, "ok");
});

test("callOpenRouterNonStreaming switches to the fallback model after a wrapped 200 error", async () => {
  const models: string[] = [];

  const deps = createOpenRouterNonStreamingDepsForTest({
    fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      models.push(String(body.model));
      if (models.length === 1) {
        return jsonResponse(200, { error: { message: "primary failed" } }) as any;
      }
      return jsonResponse(200, {
        choices: [{ message: { content: "fallback ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }) as any;
    },
  });

  const result = await callOpenRouterNonStreaming(
    "key",
    "model_primary",
    [{ role: "user", content: "hi" }],
    {},
    { fallbackModel: "model_fallback" },
    deps,
  );

  assert.deepEqual(models, ["model_primary", "model_fallback"]);
  assert.equal(result.content, "fallback ok");
});

test("callOpenRouterStreaming retries transient network failures and uses text-stream fallback when no body is available", async () => {
  let fetchCount = 0;
  const textCalls: string[] = [];
  const sleepCalls: number[] = [];

  const deps = createOpenRouterStreamingDepsForTest({
    sleep: async (ms: number) => {
      sleepCalls.push(ms);
    },
    fetch: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        const error = new Error("fetch failed") as Error & { cause?: string };
        error.cause = "socket hang up";
        throw error;
      }
      return textResponse(200, "data: eventual stream", null) as any;
    },
    processSSETextStream: async (text: string) => {
      textCalls.push(text);
      return {
        content: "stream ok",
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

  const result = await callOpenRouterStreaming(
    "key",
    "openai/gpt-4.1",
    [{ role: "user", content: "hello" }],
    {},
    {},
    {},
    deps,
  );

  assert.equal(fetchCount, 2);
  assert.deepEqual(sleepCalls, [2000]);
  assert.deepEqual(textCalls, ["data: eventual stream"]);
  assert.equal(result.content, "stream ok");
});

test("callOpenRouterStreaming retries empty responses and then falls back to the backup model", async () => {
  const models: string[] = [];

  let processCount = 0;
  const deps = createOpenRouterStreamingDepsForTest({
    fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      models.push(String(body.model));
      return textResponse(200, "data: noop", null) as any;
    },
    processSSETextStream: async () => {
      processCount += 1;
      if (processCount < 3) {
        return {
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
      }
      return {
        content: "fallback content",
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
    sleep: async () => undefined,
  });

  const result = await callOpenRouterStreaming(
    "key",
    "primary_model",
    [{ role: "user", content: "hello" }],
    {},
    {},
    {
      emptyStreamRetries: 1,
      emptyStreamBackoffs: [0],
      fallbackModel: "fallback_model",
    },
    deps,
  );

  assert.deepEqual(models, ["primary_model", "primary_model", "fallback_model"]);
  assert.equal(result.content, "fallback content");
});

test("callOpenRouterStreaming normalizes abort timeouts into a stable error message", async () => {
  const deps = createOpenRouterStreamingDepsForTest({
    fetch: async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
  });

  await assert.rejects(
    () =>
      callOpenRouterStreaming(
        "key",
        "timed_out_model",
        [{ role: "user", content: "hello" }],
        {},
        {},
        {},
        deps,
      ),
    /OpenRouter stream timeout/i,
  );
});

test("callOpenRouterStreaming normalizes non-Error AbortError shapes (DOMException-like)", async () => {
  // Regression for April 2026 production incident: on the Convex Node
  // runtime, aborted fetches can surface as DOMException or other non-Error
  // objects where `instanceof Error` is false. The classifier must rely on
  // structural `.name === "AbortError"` rather than an `instanceof Error`
  // gate, otherwise the error bubbles up as bare "AbortError" with no
  // timeout flag and no retry attempt.
  const fakeAbort: { name: string; message: string; cause?: unknown } = {
    name: "AbortError",
    message: "This operation was aborted",
  };
  const deps = createOpenRouterStreamingDepsForTest({
    fetch: async () => {
      throw fakeAbort;
    },
  });

  await assert.rejects(
    () =>
      callOpenRouterStreaming(
        "key",
        "timed_out_model",
        [{ role: "user", content: "hello" }],
        {},
        {},
        {},
        deps,
      ),
    /OpenRouter stream timeout/i,
  );
});

test("callOpenRouterNonStreaming normalizes non-Error AbortError shapes (DOMException-like)", async () => {
  const fakeAbort: { name: string; message: string } = {
    name: "AbortError",
    message: "This operation was aborted",
  };
  const deps = createOpenRouterNonStreamingDepsForTest({
    fetch: async () => {
      throw fakeAbort;
    },
  });

  await assert.rejects(
    () =>
      callOpenRouterNonStreaming(
        "key",
        "timed_out_model",
        [{ role: "user", content: "hello" }],
        {},
        {},
        deps,
      ),
    /OpenRouter non-stream timeout/i,
  );
});
