import assert from "node:assert/strict";
import test from "node:test";

import { resolveImageGenerationOptions } from "../chat/image_generation_defaults";
import { callOpenRouterImage } from "../lib/openrouter_image";

test("image defaults clamp ranges and choose safe nearest advertised values", () => {
  const resolved = resolveImageGenerationOptions({
    count: 9,
    aspectRatio: "3:2",
    resolution: "1500p",
    quality: "medium",
    background: "transparent",
    outputFormat: "jpeg",
    outputCompression: 98,
  }, {
    n: { type: "range", min: 1, max: 4 },
    aspect_ratio: { type: "enum", values: ["1:1", "16:9", "9:16"] },
    resolution: { type: "enum", values: ["512p", "1024p", "2048p"] },
    quality: { type: "enum", values: ["low", "high"] },
    background: { type: "enum", values: ["opaque", "transparent"] },
    output_format: { type: "enum", values: ["jpeg", "png", "webp"] },
    output_compression: { type: "range", min: 0, max: 90 },
  });

  assert.deepEqual(resolved, {
    n: 4,
    aspectRatio: "16:9",
    resolution: "1024p",
    quality: "low",
    background: "transparent",
    outputFormat: "png",
  });
});

test("resolution falls upward when no lower tier exists and supports size fallback", () => {
  assert.deepEqual(resolveImageGenerationOptions({ resolution: "300p" }, {
    resolution: { values: ["512p", "1024p"] },
  }), { resolution: "512p" });

  assert.deepEqual(resolveImageGenerationOptions({ resolution: "1500p" }, {
    size: { values: ["512p", "1024p", "2048p"] },
  }), { size: "1024p" });
});

test("discrete image counts resolve only to advertised enum values", () => {
  const parameters = {
    n: { type: "enum", values: ["1", "4"] },
  };

  assert.deepEqual(resolveImageGenerationOptions({ count: 3 }, parameters), {
    n: 1,
  });
  assert.deepEqual(resolveImageGenerationOptions({ count: 2 }, parameters), {
    n: 1,
  });
  assert.deepEqual(resolveImageGenerationOptions({ count: 10 }, parameters), {
    n: 4,
  });
  assert.deepEqual(resolveImageGenerationOptions({ count: 3 }, {
    n: { type: "enum", values: ["4", "8"] },
  }), { n: 4 });
  assert.deepEqual(resolveImageGenerationOptions({ count: 3 }, {
    n: { type: "enum", values: ["auto", "many"] },
  }), {});
});

test("auto, blank, and unsupported image defaults are omitted", () => {
  const resolved = resolveImageGenerationOptions({
    count: 2,
    aspectRatio: "auto",
    resolution: " ",
    quality: "auto",
    background: "transparent",
    outputFormat: "webp",
    outputCompression: 40,
  }, {
    aspect_ratio: { values: ["1:1"] },
    quality: { values: ["low", "high"] },
  });
  assert.deepEqual(resolved, {});
  assert.deepEqual(resolveImageGenerationOptions({}, {}), {});
});

test("transparent JPEG omits transparency when no safe format is advertised", () => {
  assert.deepEqual(resolveImageGenerationOptions({
    background: "transparent",
    outputFormat: "jpeg",
  }, {
    background: { values: ["transparent", "opaque"] },
    output_format: { values: ["jpeg"] },
  }), { outputFormat: "jpeg" });
});

test("image request preserves zero compression and never sends size with resolution", async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> = {};
  try {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        data: [{ b64_json: "AAEC", media_type: "image/webp" }],
      }), { status: 200 });
    }) as typeof fetch;

    await callOpenRouterImage("test-key", {
      model: "example/image",
      prompt: "A lighthouse",
      n: 2,
      aspectRatio: "16:9",
      resolution: "1024p",
      size: "2048p",
      quality: "high",
      background: "opaque",
      outputFormat: "webp",
      outputCompression: 0,
    });

    assert.deepEqual(body, {
      model: "example/image",
      prompt: "A lighthouse",
      n: 2,
      aspect_ratio: "16:9",
      resolution: "1024p",
      quality: "high",
      background: "opaque",
      output_format: "webp",
      output_compression: 0,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("empty image config produces no optional request fields", async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> = {};
  try {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        data: [{ b64_json: "AAEC", media_type: "image/png" }],
      }), { status: 200 });
    }) as typeof fetch;
    await callOpenRouterImage("test-key", {
      model: "example/image",
      prompt: "A lighthouse",
    });
    assert.deepEqual(body, {
      model: "example/image",
      prompt: "A lighthouse",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
