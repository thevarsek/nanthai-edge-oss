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

test("AA index keeps unknown-provider entries searchable by display name", () => {
  const entries: AaLlmEntry[] = [
    { slug: "frontier-model", name: "Frontier Preview" },
  ];
  const index = buildAaIndex(entries);

  const unknownProvider = index.get("unknown");
  assert.ok(unknownProvider);
  assert.equal(unknownProvider.byNormalizedName.get("frontier-preview")?.[0]?.slug, "frontier-model");
});

test("variant resolution honors raw route matches and profile hints inside an AA family", () => {
  const entries: AaLlmEntry[] = [
    { slug: "claude.sonnet.4.6.low.effort", creatorSlug: "anthropic" },
    { slug: "claude-sonnet-4-6", creatorSlug: "anthropic" },
    { slug: "claude-sonnet-4-6-low-effort", creatorSlug: "anthropic" },
    { slug: "claude-sonnet-4-6-medium-effort", creatorSlug: "anthropic" },
  ];
  const index = buildAaIndex(entries);

  const rawMatch = matchModelLlm({
    id: "anthropic/claude-sonnet-4.6-low-effort",
    name: "Anthropic: Claude Sonnet 4.6 Low Effort",
  }, index);
  const profileMatch = matchModelLlm({
    id: "anthropic/claude-sonnet-4.6-medium",
    name: "Anthropic: Claude Sonnet 4.6 Medium",
  }, index);

  assert.equal(rawMatch.status, "matched");
  assert.equal(rawMatch.aaSlug, "claude.sonnet.4.6.low.effort");
  assert.match(String(rawMatch.notes?.[0]), /exact raw match/);
  assert.equal(profileMatch.status, "matched");
  assert.equal(profileMatch.aaSlug, "claude-sonnet-4-6-medium-effort");
  assert.match(String(profileMatch.notes?.[0]), /profile token match/);
});

test("family matching rejects identity-token divergences and reports unresolved sibling ambiguity", () => {
  const divergentIndex = buildAaIndex([
    { slug: "future-model-pro", creatorSlug: "openai" },
  ]);
  const entries: AaLlmEntry[] = [
    { slug: "future-model-alpha-one", creatorSlug: "openai" },
    { slug: "future-model-alpha-two", creatorSlug: "openai" },
  ];
  const index = buildAaIndex(entries);

  const divergent = matchModelLlm({
    id: "openai/future-model",
    name: "OpenAI: Future Model",
  }, divergentIndex);
  const ambiguous = matchModelLlm({
    id: "openai/future-model-alpha",
    name: "OpenAI: Future Model Alpha",
  }, index);

  assert.equal(divergent.status, "unmatched");
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.familyKey, "future-model-alpha");
  assert.match(String(ambiguous.notes?.[1]), /ambiguous after all filters/);
});

test("mode-aware family matching prefers explicit mode variants and undated bases", () => {
  const entries: AaLlmEntry[] = [
    { slug: "gpt-5-reasoning", creatorSlug: "openai" },
    { slug: "gpt-5-reasoning-20260305", creatorSlug: "openai" },
  ];
  const index = buildAaIndex(entries);

  const reasoning = matchModelLlm({
    id: "openai/gpt-5",
    name: "OpenAI: GPT-5 Reasoning Preview",
  }, index);

  assert.equal(reasoning.status, "matched");
  assert.equal(reasoning.aaSlug, "gpt-5-reasoning");
  assert.match(String(reasoning.notes?.[0]), /undated variant preferred/);
});

test("batch guidance matching falls back to image-only matches and returns null when AA has no coverage", () => {
  const imageOnly = matchModel({
    id: "google/imagen-4-ultra",
    name: "Google: Imagen 4 Ultra",
  }, [], [{ slug: "imagen-4-ultra" }]);
  const noMatch = matchModel({
    id: "vendor/unlisted-model",
    name: "Vendor: Unlisted Model",
  }, [], []);

  assert.deepEqual(imageOnly, {
    source: "artificial_analysis",
    strategy: "exact_slug",
    confidence: 0.90,
    aaImageSlug: "imagen-4-ultra",
  });
  assert.equal(noMatch, null);
});
