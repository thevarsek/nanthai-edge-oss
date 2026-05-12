import assert from "node:assert/strict";
import test from "node:test";

import { extractErrorMessage } from "../lib/openrouter_error";
import {
  extractContentFromNonStreamingPayload,
  parseSSELines,
  processSSEEvent,
} from "../lib/openrouter_sse_event";

test("parseSSELines handles comments, named events, multiline data, and trailing partial events", () => {
  assert.deepEqual(
    Array.from(parseSSELines([
      ": keepalive",
      "event: chunk",
      "data: {\"a\":1}",
      "data: {\"b\":2}",
      "",
      "event: done",
      "data: [DONE]",
    ].join("\n"))),
    [
      { event: "chunk", data: "{\"a\":1}\n{\"b\":2}" },
      { event: "done", data: "[DONE]" },
    ],
  );
});

test("processSSEEvent covers state lifecycle, malformed payloads, and structured OpenRouter errors", () => {
  assert.deepEqual(processSSEEvent({ data: "[DONE]" }), { done: true, terminal: true });
  assert.deepEqual(processSSEEvent({ data: "{" }), {});
  assert.deepEqual(processSSEEvent({ data: JSON.stringify({ type: "state", state: "complete" }) }), { done: true });
  assert.deepEqual(processSSEEvent({ data: JSON.stringify({ type: "state", state: "running" }) }), {});

  const failed = processSSEEvent({
    event: "response.failed",
    data: JSON.stringify({
      error: {
        message: "Provider failed",
        metadata: {
          provider_name: "OpenAI",
          code: 429,
          type: "rate_limit",
          raw: "{\"message\":\"Retry later\"}",
        },
      },
    }),
  });
  assert.equal(failed.error, "Provider failed (provider: OpenAI; code: 429; type: rate_limit) Retry later");
});

test("processSSEEvent extracts content, reasoning, images, and usage from response event families", () => {
  assert.deepEqual(processSSEEvent({
    event: "chunk",
    data: JSON.stringify({
      content: [
        { type: "text", text: "Hi" },
        { image_url: { url: "https://example.com/a.png" } },
      ],
      reasoning: "thinking",
      images: ["https://example.com/a.png", "https://example.com/b.png"],
      output: { image: "A".repeat(80) },
    }),
  }), {
    contentDelta: "Hi",
    reasoningDelta: "thinking",
    imageUrls: [
      "https://example.com/a.png",
      "https://example.com/b.png",
      `data:image/png;base64,${"A".repeat(80)}`,
    ],
  });

  assert.deepEqual(processSSEEvent({
    data: JSON.stringify({
      type: "response.output_item.added",
      part: [{ type: "text", text: "part" }],
      item: { image_url: { url: "https://example.com/item.png" } },
      reasoning: "why",
    }),
  }), {
    contentDelta: "part",
    reasoningDelta: "why",
    imageUrls: ["https://example.com/item.png"],
  });

  assert.deepEqual(processSSEEvent({
    data: JSON.stringify({
      type: "response.completed",
      response: {
        output: [{ type: "output_text", text: "done" }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      },
    }),
  }), {
    contentDelta: "done",
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    imageUrls: undefined,
    done: true,
  });
});

test("processSSEEvent covers delta/done event aliases for text, reasoning, and images", () => {
  assert.deepEqual(processSSEEvent({
    event: "response.output_text.delta",
    data: JSON.stringify({ delta: "token" }),
  }), { contentDelta: "token" });
  assert.deepEqual(processSSEEvent({
    event: "response.output_text.done",
    data: JSON.stringify({ text: "final" }),
  }), { contentDelta: "final" });
  assert.deepEqual(processSSEEvent({
    event: "response.reasoning.delta",
    data: JSON.stringify({ delta: "reason" }),
  }), { reasoningDelta: "reason" });
  assert.deepEqual(processSSEEvent({
    event: "response.reasoning.done",
    data: JSON.stringify({ reasoning: "summary" }),
  }), { reasoningDelta: "summary" });
  assert.deepEqual(processSSEEvent({
    event: "response.output_image.done",
    data: JSON.stringify({
      image: { url: "https://example.com/one.png" },
      images: ["https://example.com/two.png"],
      image_url: "https://example.com/three.png",
      delta: "B".repeat(80),
    }),
  }), {
    imageUrls: [
      "https://example.com/one.png",
      "https://example.com/two.png",
      "https://example.com/three.png",
      `data:image/png;base64,${"B".repeat(80)}`,
    ],
  });
});

test("processSSEEvent reads OpenRouter choice chunks including reasoning details, annotations, tools, and usage", () => {
  const result = processSSEEvent({
    data: JSON.stringify({
      id: "gen_123",
      choices: [{
        delta: {
          content: [{ type: "text", text: "Hello" }],
          audio: { data: "QUJD", transcript: "abc" },
          reasoning_details: [
            { type: "reasoning.encrypted", data: "opaque" },
            { type: "reasoning.text", text: "  step one  " },
            { type: "reasoning.summary", summary: " summary " },
          ],
          images: ["https://example.com/image.png"],
          tool_calls: [{ index: 0, id: "call_1", function: { name: "search", arguments: "{}" } }],
          annotations: [
            { type: "url_citation", url_citation: { url: "https://example.com/source" } },
            { type: "url_citation", url_citation: {} },
          ],
        },
        finish_reason: "tool_calls",
      }],
      usage: {
        prompt_tokens: 4,
        completion_tokens: 5,
        total_tokens: 9,
        prompt_tokens_details: { cached_tokens: 2 },
      },
    }),
  });

  assert.equal(result.generationId, "gen_123");
  assert.equal(result.contentDelta, "Hello");
  assert.equal(result.audioDelta, "QUJD");
  assert.equal(result.audioTranscriptDelta, "abc");
  assert.equal(result.reasoningDelta, "step one\n\nsummary");
  assert.deepEqual(result.imageUrls, ["https://example.com/image.png"]);
  assert.equal(result.toolCallDeltas?.length, 1);
  assert.equal(result.annotations?.length, 1);
  assert.equal(result.finishReason, "tool_calls");
  assert.equal(result.done, true);
  assert.deepEqual(result.usage, {
    promptTokens: 4,
    completionTokens: 5,
    totalTokens: 9,
    cachedTokens: 2,
  });
});

test("extractContentFromNonStreamingPayload falls through content shapes and preserves audio", () => {
  assert.deepEqual(extractContentFromNonStreamingPayload({
    choices: [{
      message: { audio: { data: "QUJD", transcript: "abc" } },
      text: "choice text",
      finish_reason: "stop",
    }],
    response: { usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } },
  }), {
    content: "choice text",
    finishReason: "stop",
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    audioBase64: "QUJD",
    audioTranscript: "abc",
  });

  assert.equal(extractContentFromNonStreamingPayload({
    output_text: [{ type: "output_text", text: "fallback" }],
  }).content, "fallback");
});

test("extractErrorMessage covers string, simple, metadata, duplicate raw, and unknown forms", () => {
  assert.equal(extractErrorMessage("plain failure"), "plain failure");
  assert.equal(extractErrorMessage("{\"error\":\"simple\"}"), "simple");
  assert.equal(extractErrorMessage({ message: "root message" }), "root message");
  assert.equal(extractErrorMessage({
    error: {
      message: "same",
      metadata: {
        provider: "Anthropic",
        raw: "{\"message\":\"same\"}",
      },
    },
  }), "same (provider: Anthropic)");
  assert.equal(extractErrorMessage(null), "Unknown OpenRouter error.");
});

test("processSSEEvent covers sparse event payloads without inventing deltas", () => {
  assert.deepEqual(processSSEEvent({
    data: JSON.stringify({ type: "state", state: "error", error: { message: "state failed" } }),
  }), { error: "state failed" });
  assert.deepEqual(processSSEEvent({
    event: "chunk",
    data: JSON.stringify({ content: "", reasoning: "", images: [] }),
  }), {
    contentDelta: "",
    reasoningDelta: undefined,
    imageUrls: undefined,
  });
  assert.deepEqual(processSSEEvent({
    event: "complete",
    data: JSON.stringify({ content: "" }),
  }), {
    contentDelta: undefined,
    usage: undefined,
    done: true,
  });
  assert.deepEqual(processSSEEvent({
    event: "response.output_image.delta",
    data: JSON.stringify({ delta: "" }),
  }), { imageUrls: undefined });
});

test("processSSEEvent handles response-completed top-level usage and non-object response payloads", () => {
  assert.deepEqual(processSSEEvent({
    data: JSON.stringify({
      type: "response.completed",
      content: [{ type: "text", text: "from content" }],
      output: [{ type: "output_image", image_url: "https://example.com/from-output.png" }],
      response: 42,
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }),
  }), {
    contentDelta: "from content",
    usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
    imageUrls: ["https://example.com/from-output.png"],
    done: true,
  });
});

test("processSSEEvent reads complete choice messages when providers omit streaming delta", () => {
  const result = processSSEEvent({
    data: JSON.stringify({
      choices: [{
        message: {
          content: [{ type: "text", text: "message text" }],
          reasoning: "message reasoning",
          images: ["https://example.com/message.png"],
          tool_calls: [{ id: "call_1", function: { name: "lookup", arguments: "{}" } }],
          annotations: [{ type: "url_citation", url_citation: { url: "https://example.com/citation" } }],
        },
        finish_reason: "stop",
      }],
    }),
  });

  assert.equal(result.contentDelta, "message text");
  assert.equal(result.reasoningDelta, "message reasoning");
  assert.deepEqual(result.imageUrls, ["https://example.com/message.png"]);
  assert.equal(result.toolCallDeltas?.[0]?.id, "call_1");
  assert.equal(result.annotations?.[0]?.url_citation.url, "https://example.com/citation");
  assert.equal(result.done, true);
});

test("processSSEEvent returns usage-only chunks and non-streaming extraction falls through output", () => {
  assert.deepEqual(processSSEEvent({
    data: JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
  }), { usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
  assert.equal(extractContentFromNonStreamingPayload({
    output: [{ type: "output_text", text: "output fallback" }],
  }).content, "output fallback");
});
