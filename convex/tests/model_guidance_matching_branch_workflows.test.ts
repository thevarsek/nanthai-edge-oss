import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAaIndex,
  matchModel,
  matchModelImage,
  matchModelLlm,
  type AaImageEntry,
  type AaLlmEntry,
  type OrModelInput,
} from "../models/guidance_matching";

test("guidance matching uses canonical slug aliases when OpenRouter route ids differ from AA slugs", () => {
  const entries: AaLlmEntry[] = [
    { slug: "gpt-4o-mini", creatorSlug: "openai" },
    { slug: "gpt-4o", creatorSlug: "openai" },
  ];
  const index = buildAaIndex(entries);

  const result = matchModelLlm({
    id: "openai/chatgpt-4o-mini",
    name: "OpenAI: ChatGPT 4o Mini",
    canonicalSlug: "openai/gpt-4o-mini-20240718",
  }, index);

  assert.equal(result.status, "matched");
  assert.equal(result.aaSlug, "gpt-4o-mini");
  assert.equal(result.rule, "canonical_slug_minus_date");
  assert.equal(result.confidence, "high");
});

test("guidance matching falls back from display names to AA slugs before family matching", () => {
  const entries: AaLlmEntry[] = [
    { slug: "glm-4-5-air", creatorSlug: "zai" },
  ];
  const index = buildAaIndex(entries);

  const result = matchModelLlm({
    id: "z-ai/temporary-route",
    name: "Z.ai: GLM 4.5 Air",
  }, index);

  assert.equal(result.status, "matched");
  assert.equal(result.aaSlug, "glm-4-5-air");
  assert.equal(result.rule, "display_name_exact");
});

test("guidance matching reports ambiguous same-family variants instead of guessing", () => {
  const entries: AaLlmEntry[] = [
    { slug: "future-model-alpha", creatorSlug: "openai" },
    { slug: "future-model-bravo", creatorSlug: "openai" },
  ];
  const index = buildAaIndex(entries);

  const result = matchModelLlm({
    id: "openai/future-model",
    name: "OpenAI: Future Model",
  }, index);

  assert.equal(result.status, "ambiguous");
  assert.equal(result.familyKey, "future-model");
  assert.ok(result.notes?.[0]?.includes("future-model-alpha"));
  assert.ok(result.notes?.[0]?.includes("future-model-bravo"));
});

test("guidance image matching accepts dated OpenRouter image aliases", () => {
  const imageEntries: AaImageEntry[] = [
    { slug: "imagen-4-ultra" },
  ];

  assert.equal(
    matchModelImage("google/imagen-4-ultra-20260115", imageEntries),
    "imagen-4-ultra",
  );
});

test("batch guidance matching reuses a supplied AA index and attaches image matches to LLM matches", () => {
  const llmEntries: AaLlmEntry[] = [
    { slug: "gpt-5-image", creatorSlug: "openai" },
  ];
  const imageEntries: AaImageEntry[] = [
    { slug: "gpt-5-image" },
  ];
  const index = buildAaIndex(llmEntries);
  const model: OrModelInput = {
    id: "openai/gpt-5-image",
    name: "OpenAI: GPT-5 Image",
  };

  const result = matchModel(model, [], imageEntries, index);

  assert.deepEqual(result, {
    source: "artificial_analysis",
    strategy: "exact_slug",
    confidence: 0.95,
    aaLlmSlug: "gpt-5-image",
    aaImageSlug: "gpt-5-image",
  });
});
