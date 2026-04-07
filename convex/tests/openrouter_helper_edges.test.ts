import assert from "node:assert/strict";
import test from "node:test";

import {
  extractFirstTextFromUnknown,
  extractImageUrlsFromUnknown,
  extractTextAndImages,
  usageFromUnknown,
} from "../lib/openrouter_extract";
import { gateParameters } from "../lib/openrouter_gate";
import {
  normalizeUnsupportedParameterName,
  parseUnsupportedParameter,
  stripParameter,
} from "../lib/openrouter_param_retry";

test("parseUnsupportedParameter reads nested payloads and stripParameter clears supported fields", () => {
  const param = parseUnsupportedParameter({
    error: {
      details: "Unknown name reasoning_effort",
    },
  });

  assert.equal(param, "reasoning");
  assert.equal(normalizeUnsupportedParameterName("max_completion_tokens"), "max_tokens");

  const stripped = stripParameter("web_search", {
    webSearchEnabled: true,
    maxTokens: 200,
    reasoningEffort: "high",
  });
  assert.deepEqual(stripped, {
    webSearchEnabled: false,
    maxTokens: 200,
    reasoningEffort: "high",
  });
});

test("gateParameters applies image-generation and reasoning support rules", () => {
  const gatedImage = gateParameters(
    {
      temperature: 0.7,
      includeReasoning: true,
      reasoningEffort: "high",
      modalities: ["text"],
      imageConfig: { aspectRatio: "1:1" },
    },
    ["max_tokens"],
    true,
    false,
  );
  const gatedReasoningFallback = gateParameters(
    {
      includeReasoning: true,
      reasoningEffort: "medium",
      temperature: 0.4,
    },
    undefined,
    false,
    false,
  );

  assert.deepEqual(gatedImage.modalities, ["image"]);
  assert.equal(gatedImage.temperature, null);
  assert.equal(gatedImage.includeReasoning, null);
  assert.equal(gatedReasoningFallback.includeReasoning, false);
  assert.equal(gatedReasoningFallback.reasoningEffort, null);
});

test("OpenRouter extract helpers recover text, images, and usage from heterogeneous payloads", () => {
  const content = extractTextAndImages([
    { type: "text", text: "Hello " },
    { type: "output_text", text: "world" },
    { type: "image", base64: "A".repeat(80) },
    { image_url: { url: "https://example.com/image.png" } },
  ]);
  const images = extractImageUrlsFromUnknown({
    image_url: { url: "https://example.com/one.png" },
    image: "B".repeat(80),
  });
  const text = extractFirstTextFromUnknown({
    output: [{ type: "text", text: "Primary text" }],
  });
  const usage = usageFromUnknown({
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
    cost: 0.12,
    prompt_tokens_details: { cached_tokens: 3 },
    completion_tokens_details: { reasoning_tokens: 2 },
  });

  assert.equal(content.text, "Hello world");
  assert.equal(content.imageUrls.length, 2);
  assert.equal(images.length, 2);
  assert.equal(text, "Primary text");
  assert.deepEqual(usage, {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    cost: 0.12,
    cachedTokens: 3,
    reasoningTokens: 2,
  });
});
