import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { buildImageGenerationRequest } from "../chat/image_generation_request";
import {
  callOpenRouterImage,
  OPENROUTER_IMAGE_API_URL,
} from "../lib/openrouter_image";
import { parseOpenRouterImageResponse } from "../lib/openrouter_image_response";

test("buildImageGenerationRequest carries recent text and caps image references", () => {
  const request = buildImageGenerationRequest({
    model: "openai/gpt-image-2",
    prompt: "  Make the newest image blue  ",
    maxInputReferences: 1,
    messages: [
      { role: "user", content: "old" },
      {
        role: "user",
        content: [
          { type: "text", text: "Make it blue" },
          { type: "image_url", image_url: { url: "https://example.com/a.png" } },
          { type: "image_url", image_url: { url: "https://example.com/b.png" } },
        ],
      },
    ],
  });

  assert.equal(request.model, "openai/gpt-image-2");
  assert.match(request.prompt, /Recent selected-branch conversation:\nUser: old/);
  assert.ok(request.prompt.endsWith(
    "Current image request:\nMake the newest image blue",
  ));
  assert.deepEqual(request.inputReferences, [{
    type: "image_url",
    image_url: { url: "https://example.com/a.png" },
  }]);
});

test("callOpenRouterImage sends the dedicated API shape and parses media usage", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody: unknown;
  try {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        data: [
          { b64_json: "AAEC", media_type: "image/png" },
          { b64_json: "PHN2Zy8+", media_type: "image/svg+xml" },
        ],
        usage: {
          prompt_tokens: 2,
          completion_tokens: 3,
          total_tokens: 5,
          cost: 0.01,
        },
      }), {
        status: 200,
        headers: { "X-Generation-Id": "gen_image_1" },
      });
    }) as typeof fetch;

    const result = await callOpenRouterImage("test-key", {
      model: "openai/gpt-image-2",
      prompt: "A blue circle",
      inputReferences: [{
        type: "image_url",
        image_url: { url: "https://example.com/ref.png" },
      }],
    });
    assert.equal(capturedUrl, OPENROUTER_IMAGE_API_URL);
    assert.deepEqual(capturedBody, {
      model: "openai/gpt-image-2",
      prompt: "A blue circle",
      input_references: [{
        type: "image_url",
        image_url: { url: "https://example.com/ref.png" },
      }],
    });
    assert.deepEqual(result.imageDataUrls, [
      "data:image/png;base64,AAEC",
      "data:image/svg+xml;base64,PHN2Zy8+",
    ]);
    assert.equal(result.imageCount, 2);
    assert.equal(result.usage?.cost, 0.01);
    assert.equal(result.generationId, "gen_image_1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callOpenRouterImage incrementally emits image objects without retaining the batch", async () => {
  const originalFetch = globalThis.fetch;
  const emitted: Array<{ base64: string; mediaType: string }> = [];
  try {
    const serialized = JSON.stringify({
      created: 123,
      data: [
        { b64_json: "A".repeat(70_000), media_type: "image/png" },
        { b64_json: "Qg==", media_type: "image/webp" },
        { b64_json: "Qw==", media_type: "image/svg+xml" },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, cost: 0.02 },
    });
    const boundaries = [7, 19, 65_537, serialized.length - 11];
    const chunks = boundaries.map((start, index) =>
      serialized.slice(start, boundaries[index + 1] ?? serialized.length)
    );
    chunks.unshift(serialized.slice(0, boundaries[0]));
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    }), { status: 200 })) as typeof fetch;

    const result = await callOpenRouterImage("test-key", {
      model: "openai/gpt-image-2",
      prompt: "Three images",
      n: 3,
    }, {
      onImage: async (image) => {
        emitted.push({ base64: image.base64, mediaType: image.mediaType });
      },
    });

    assert.equal(result.imageCount, 3);
    assert.deepEqual(result.imageDataUrls, []);
    assert.deepEqual(emitted.map((image) => image.mediaType), [
      "image/png",
      "image/webp",
      "image/svg+xml",
    ]);
    assert.equal(emitted[0]?.base64.length, 70_000);
    assert.equal(result.usage?.cost, 0.02);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streaming image parser rejects an oversized item before JSON parsing", async () => {
  let emitted = false;
  const response = new Response(JSON.stringify({
    data: [{ b64_json: "A".repeat(128), media_type: "image/png" }],
  }));

  await assert.rejects(
    parseOpenRouterImageResponse(
      response,
      async () => {
        emitted = true;
      },
      { maxObjectChars: 64 },
    ),
    /safe size limit/,
  );
  assert.equal(emitted, false);
});

test("callOpenRouterImage preserves structured upstream failures", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: {
        code: 400,
        message: "Unsupported image option",
        metadata: { error_type: "invalid_request" },
      },
    }), { status: 400 })) as typeof fetch;

    await assert.rejects(
      callOpenRouterImage("test-key", {
        model: "openai/gpt-image-2",
        prompt: "test",
      }),
      (error: unknown) =>
        error instanceof ConvexError &&
        String(error.data?.message).includes("OpenRouter request failed (HTTP 400)"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callOpenRouterImage rejects successful responses without image data", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [],
      usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
    }), { status: 200 })) as typeof fetch;

    await assert.rejects(
      callOpenRouterImage("test-key", {
        model: "openai/gpt-image-2",
        prompt: "test",
      }),
      (error: unknown) =>
        error instanceof ConvexError &&
        String(error.data?.message).includes("returned no image payload"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callOpenRouterImage honors an expired action deadline before dispatch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  try {
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await assert.rejects(
      callOpenRouterImage(
        "test-key",
        { model: "openai/gpt-image-2", prompt: "test" },
        { absoluteDeadlineAtMs: Date.now() - 1 },
      ),
      (error: unknown) =>
        error instanceof ConvexError && error.data?.code === "TIMEOUT",
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
