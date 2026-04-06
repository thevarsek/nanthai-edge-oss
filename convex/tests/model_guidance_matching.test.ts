import assert from "node:assert/strict";
import test from "node:test";

import {
  normalize,
  extractOrParts,
  extractCanonicalSlugPart,
  stripDateSuffix,
  cleanDisplayName,
  resolveAaProvider,
  buildAaIndex,
  matchModelLlm,
  matchModel,
  matchModelImage,
  buildSlugIndex,
  type AaLlmEntry,
  type AaImageEntry,
  type OrModelInput,
} from "../models/guidance_matching";
import { getManualOverride, MANUAL_OVERRIDES } from "../models/guidance_manual_overrides";

// =============================================================================
// normalize
// =============================================================================

test("normalize replaces dots with hyphens", () => {
  assert.equal(normalize("gpt-5.4"), "gpt-5-4");
  assert.equal(normalize("gemini-3.1-pro-preview"), "gemini-3-1-pro-preview");
});

test("normalize lowercases", () => {
  assert.equal(normalize("Claude-Sonnet-4.6"), "claude-sonnet-4-6");
});

test("normalize replaces & with and", () => {
  // & is replaced with "and", then no separator remains → concatenated
  assert.equal(normalize("this&that"), "thisandthat");
  // With spaces around &, hyphens appear
  assert.equal(normalize("this & that"), "this-and-that");
});

test("normalize collapses non-alphanumeric runs", () => {
  assert.equal(normalize("Qwen3 Coder 480B A35B"), "qwen3-coder-480b-a35b");
  assert.equal(normalize("   a  b  "), "a-b");
});

test("normalize trims leading/trailing hyphens", () => {
  assert.equal(normalize("-foo-"), "foo");
});

// =============================================================================
// extractOrParts
// =============================================================================

test("extractOrParts splits provider and raw slug", () => {
  const { provider, rawSlug } = extractOrParts("openai/gpt-5.4");
  assert.equal(provider, "openai");
  assert.equal(rawSlug, "gpt-5.4");
});

test("extractOrParts strips :free suffix", () => {
  const { rawSlug } = extractOrParts("minimax/minimax-m2.5:free");
  assert.equal(rawSlug, "minimax-m2.5");
});

test("extractOrParts strips :thinking suffix", () => {
  const { rawSlug } = extractOrParts("anthropic/claude-3.7-sonnet:thinking");
  assert.equal(rawSlug, "claude-3.7-sonnet");
});

test("extractOrParts handles bare slugs", () => {
  const { provider, rawSlug } = extractOrParts("gpt-4o");
  assert.equal(provider, "unknown");
  assert.equal(rawSlug, "gpt-4o");
});

// =============================================================================
// extractCanonicalSlugPart
// =============================================================================

test("extractCanonicalSlugPart returns second segment", () => {
  assert.equal(
    extractCanonicalSlugPart("openai/gpt-5.4-20260305"),
    "gpt-5.4-20260305",
  );
});

test("extractCanonicalSlugPart returns whole string if no slash", () => {
  assert.equal(extractCanonicalSlugPart("gpt-5.4"), "gpt-5.4");
});

test("extractCanonicalSlugPart returns undefined for undefined", () => {
  assert.equal(extractCanonicalSlugPart(undefined), undefined);
});

// =============================================================================
// stripDateSuffix
// =============================================================================

test("stripDateSuffix removes YYYYMMDD", () => {
  assert.equal(stripDateSuffix("gpt-5.4-20260305"), "gpt-5.4");
});

test("stripDateSuffix removes YYYY-MM-DD", () => {
  assert.equal(stripDateSuffix("gpt-4o-2024-11-20"), "gpt-4o");
});

test("stripDateSuffix removes MM-DD", () => {
  assert.equal(stripDateSuffix("grok-4-07-09"), "grok-4");
});

test("stripDateSuffix removes YYMM", () => {
  assert.equal(stripDateSuffix("mistral-large-2407"), "mistral-large");
});

test("stripDateSuffix preserves non-date slugs", () => {
  assert.equal(stripDateSuffix("claude-sonnet-4-6"), "claude-sonnet-4-6");
});

test("stripDateSuffix handles canonical slugs from real data", () => {
  assert.equal(
    stripDateSuffix("gemini-3.1-pro-preview-20260219"),
    "gemini-3.1-pro-preview",
  );
  assert.equal(
    stripDateSuffix("minimax-m2.5-20260211"),
    "minimax-m2.5",
  );
  assert.equal(
    stripDateSuffix("deepseek-v3.2-20251201"),
    "deepseek-v3.2",
  );
  assert.equal(
    stripDateSuffix("qwen3-coder-480b-a35b-07-25"),
    "qwen3-coder-480b-a35b",
  );
});

// =============================================================================
// cleanDisplayName
// =============================================================================

test("cleanDisplayName removes provider prefix", () => {
  assert.equal(cleanDisplayName("OpenAI: GPT-5.4", "openai"), "GPT-5.4");
  assert.equal(cleanDisplayName("Z.ai: GLM 4.5 Air", "z-ai"), "GLM 4.5 Air");
});

test("cleanDisplayName removes trailing (free)", () => {
  assert.equal(
    cleanDisplayName("MiniMax: MiniMax M2.5 (free)", "minimax"),
    "MiniMax M2.5",
  );
});

test("cleanDisplayName removes parenthesized annotations", () => {
  assert.equal(
    cleanDisplayName("GPT-4o (2024-11-20)", "openai"),
    "GPT-4o",
  );
});

// =============================================================================
// resolveAaProvider
// =============================================================================

test("resolveAaProvider maps known providers", () => {
  assert.equal(resolveAaProvider("openai"), "openai");
  assert.equal(resolveAaProvider("anthropic"), "anthropic");
  assert.equal(resolveAaProvider("x-ai"), "xai");
  assert.equal(resolveAaProvider("z-ai"), "zai");
  assert.equal(resolveAaProvider("meta-llama"), "meta");
  assert.equal(resolveAaProvider("mistralai"), "mistral");
  assert.equal(resolveAaProvider("qwen"), "alibaba");
  assert.equal(resolveAaProvider("allenai"), "ai2");
  assert.equal(resolveAaProvider("liquid"), "liquidai");
});

test("resolveAaProvider returns undefined for unknown providers", () => {
  assert.equal(resolveAaProvider("unknown-provider"), undefined);
  assert.equal(resolveAaProvider("openrouter"), undefined);
});

// =============================================================================
// buildAaIndex
// =============================================================================

test("buildAaIndex creates per-provider indexes", () => {
  const entries: AaLlmEntry[] = [
    { slug: "gpt-5-4", creatorSlug: "openai" },
    { slug: "gpt-5-4-pro", creatorSlug: "openai" },
    { slug: "claude-sonnet-4-6", creatorSlug: "anthropic" },
  ];
  const index = buildAaIndex(entries);
  assert.ok(index.has("openai"));
  assert.ok(index.has("anthropic"));
  assert.equal(index.get("openai")!.allEntries.length, 2);
  assert.equal(index.get("anthropic")!.allEntries.length, 1);
});

test("buildAaIndex indexes by normalized slug", () => {
  const entries: AaLlmEntry[] = [
    { slug: "gpt-5-4", creatorSlug: "openai" },
  ];
  const index = buildAaIndex(entries);
  const openai = index.get("openai")!;
  assert.ok(openai.byNormalizedSlug.has("gpt-5-4"));
  assert.equal(openai.byNormalizedSlug.get("gpt-5-4")!.length, 1);
});

// =============================================================================
// matchModelLlm — Example A: GPT-5.4 (exact slug)
// =============================================================================

test("Example A: GPT-5.4 matches via exact slug", () => {
  const entries: AaLlmEntry[] = [
    { slug: "gpt-5-4", creatorSlug: "openai" },
    { slug: "gpt-5-4-pro", creatorSlug: "openai" },
  ];
  const index = buildAaIndex(entries);
  const or: OrModelInput = {
    id: "openai/gpt-5.4",
    name: "OpenAI: GPT-5.4",
    canonicalSlug: "openai/gpt-5.4-20260305",
  };
  const result = matchModelLlm(or, index);
  assert.equal(result.status, "matched");
  assert.equal(result.aaSlug, "gpt-5-4");
  assert.equal(result.rule, "exact_slug");
  assert.equal(result.confidence, "high");
});

// =============================================================================
// matchModelLlm — Example B: Claude Sonnet 4.6 (family + variant resolution)
// =============================================================================

test("Example B: Claude Sonnet 4.6 resolves to base via family match", () => {
  const entries: AaLlmEntry[] = [
    { slug: "claude-sonnet-4-6", creatorSlug: "anthropic" },
    { slug: "claude-sonnet-4-6-adaptive", creatorSlug: "anthropic" },
    { slug: "claude-sonnet-4-6-non-reasoning-low-effort", creatorSlug: "anthropic" },
  ];
  const index = buildAaIndex(entries);
  const or: OrModelInput = {
    id: "anthropic/claude-sonnet-4.6",
    name: "Anthropic: Claude Sonnet 4.6",
    canonicalSlug: "anthropic/claude-4.6-sonnet-20260217",
  };
  const result = matchModelLlm(or, index);
  assert.equal(result.status, "matched");
  assert.equal(result.aaSlug, "claude-sonnet-4-6");
});

// =============================================================================
// matchModelLlm — Example C: DeepSeek V3.2 (family, prefer undated base)
// =============================================================================

test("Example C: DeepSeek V3.2 resolves to undated base", () => {
  const entries: AaLlmEntry[] = [
    { slug: "deepseek-v3-2", creatorSlug: "deepseek" },
    { slug: "deepseek-v3-2-reasoning", creatorSlug: "deepseek" },
    { slug: "deepseek-v3-2-speciale", creatorSlug: "deepseek" },
    { slug: "deepseek-v3-2-0925", creatorSlug: "deepseek" },
    { slug: "deepseek-v3-2-reasoning-0925", creatorSlug: "deepseek" },
  ];
  const index = buildAaIndex(entries);
  const or: OrModelInput = {
    id: "deepseek/deepseek-v3.2",
    name: "DeepSeek: DeepSeek V3.2",
    canonicalSlug: "deepseek/deepseek-v3.2-20251201",
  };
  const result = matchModelLlm(or, index);
  assert.equal(result.status, "matched");
  assert.equal(result.aaSlug, "deepseek-v3-2");
});

// =============================================================================
// matchModelLlm — Example D: GLM 4.5 Air (direct match via slug)
// =============================================================================

test("Example D: GLM 4.5 Air matches directly", () => {
  const entries: AaLlmEntry[] = [
    { slug: "glm-4-5-air", creatorSlug: "zai" },
  ];
  const index = buildAaIndex(entries);
  const or: OrModelInput = {
    id: "z-ai/glm-4.5-air",
    name: "Z.ai: GLM 4.5 Air",
    canonicalSlug: "z-ai/glm-4.5-air",
  };
  const result = matchModelLlm(or, index);
  assert.equal(result.status, "matched");
  assert.equal(result.aaSlug, "glm-4-5-air");
  assert.equal(result.confidence, "high");
});

// =============================================================================
// matchModelLlm — Example E: MiniMax M2.5 :free route
// =============================================================================

test("Example E: MiniMax M2.5 free route matches base", () => {
  const entries: AaLlmEntry[] = [
    { slug: "minimax-m2-5", creatorSlug: "minimax" },
  ];
  const index = buildAaIndex(entries);
  const or: OrModelInput = {
    id: "minimax/minimax-m2.5:free",
    name: "MiniMax: MiniMax M2.5 (free)",
    canonicalSlug: "minimax/minimax-m2.5-20260211",
  };
  const result = matchModelLlm(or, index);
  assert.equal(result.status, "matched");
  assert.equal(result.aaSlug, "minimax-m2-5");
  assert.equal(result.confidence, "high");
});

// =============================================================================
// matchModelLlm — Example F: Qwen3 Coder (family match with -instruct)
// =============================================================================

test("Example F: Qwen3 Coder matches via canonical family", () => {
  const entries: AaLlmEntry[] = [
    { slug: "qwen3-coder-480b-a35b-instruct", creatorSlug: "alibaba" },
  ];
  const index = buildAaIndex(entries);
  const or: OrModelInput = {
    id: "qwen/qwen3-coder",
    name: "Qwen: Qwen3 Coder 480B A35B",
    canonicalSlug: "qwen/qwen3-coder-480b-a35b-07-25",
  };
  const result = matchModelLlm(or, index);
  assert.equal(result.status, "matched");
  assert.equal(result.aaSlug, "qwen3-coder-480b-a35b-instruct");
  assert.equal(result.confidence, "medium");
});

// =============================================================================
// matchModelLlm — Gemini 3.1 Pro Preview (canonical slug minus date)
// =============================================================================

test("Gemini 3.1 Pro Preview matches via canonical slug minus date", () => {
  const entries: AaLlmEntry[] = [
    { slug: "gemini-3-1-pro-preview", creatorSlug: "google" },
  ];
  const index = buildAaIndex(entries);
  const or: OrModelInput = {
    id: "google/gemini-3.1-pro-preview",
    name: "Google: Gemini 3.1 Pro Preview",
    canonicalSlug: "google/gemini-3.1-pro-preview-20260219",
  };
  const result = matchModelLlm(or, index);
  assert.equal(result.status, "matched");
  assert.equal(result.aaSlug, "gemini-3-1-pro-preview");
  assert.equal(result.confidence, "high");
});

// =============================================================================
// matchModelLlm — Mode token preservation
// =============================================================================

test("OR with 'reasoning' in id prefers AA reasoning sibling", () => {
  const entries: AaLlmEntry[] = [
    { slug: "deepseek-v3-2", creatorSlug: "deepseek" },
    { slug: "deepseek-v3-2-reasoning", creatorSlug: "deepseek" },
  ];
  const index = buildAaIndex(entries);
  const or: OrModelInput = {
    id: "deepseek/deepseek-v3.2-reasoning",
    name: "DeepSeek: DeepSeek V3.2 Reasoning",
  };
  const result = matchModelLlm(or, index);
  assert.equal(result.status, "matched");
  assert.equal(result.aaSlug, "deepseek-v3-2-reasoning");
});

test("OR without mode tokens prefers base sibling (no reasoning)", () => {
  const entries: AaLlmEntry[] = [
    { slug: "deepseek-v3-2", creatorSlug: "deepseek" },
    { slug: "deepseek-v3-2-reasoning", creatorSlug: "deepseek" },
  ];
  const index = buildAaIndex(entries);
  const or: OrModelInput = {
    id: "deepseek/deepseek-v3.2",
    name: "DeepSeek: DeepSeek V3.2",
    canonicalSlug: "deepseek/deepseek-v3.2-20251201",
  };
  const result = matchModelLlm(or, index);
  assert.equal(result.status, "matched");
  assert.equal(result.aaSlug, "deepseek-v3-2");
});

// =============================================================================
// matchModelLlm — Profile token handling
// =============================================================================

test("OR with explicit 'high' profile in slug is noted", () => {
  const entries: AaLlmEntry[] = [
    { slug: "o3-mini", creatorSlug: "openai" },
  ];
  const index = buildAaIndex(entries);
  const or: OrModelInput = {
    id: "openai/o3-mini-high",
    name: "OpenAI: o3-mini (high)",
  };
  const result = matchModelLlm(or, index);
  // Should match the base model
  assert.equal(result.status, "matched");
  assert.equal(result.orProfileHint, "high");
});

// =============================================================================
// matchModelLlm — Provider gate
// =============================================================================

test("Unknown provider returns unmatched", () => {
  const entries: AaLlmEntry[] = [
    { slug: "some-model", creatorSlug: "openai" },
  ];
  const index = buildAaIndex(entries);
  const or: OrModelInput = {
    id: "openrouter/auto",
    name: "OpenRouter: Auto",
  };
  const result = matchModelLlm(or, index);
  assert.equal(result.status, "unmatched");
  assert.ok(result.notes?.some((n) => n.includes("provider not in crosswalk")));
});

test("Known provider with no AA data returns unmatched", () => {
  const entries: AaLlmEntry[] = []; // No AA entries
  const index = buildAaIndex(entries);
  const or: OrModelInput = {
    id: "openai/gpt-future",
    name: "OpenAI: GPT Future",
  };
  const result = matchModelLlm(or, index);
  assert.equal(result.status, "unmatched");
});

// =============================================================================
// matchModelLlm — Dated variants dropped
// =============================================================================

test("Gemini 2.5 Flash prefers undated base over dated variants", () => {
  const entries: AaLlmEntry[] = [
    { slug: "gemini-2-5-flash", creatorSlug: "google" },
    { slug: "gemini-2-5-flash-04-2025", creatorSlug: "google" },
    { slug: "gemini-2-5-flash-preview-09-2025", creatorSlug: "google" },
    { slug: "gemini-2-5-flash-reasoning", creatorSlug: "google" },
  ];
  const index = buildAaIndex(entries);
  const or: OrModelInput = {
    id: "google/gemini-2.5-flash",
    name: "Google: Gemini 2.5 Flash",
  };
  const result = matchModelLlm(or, index);
  assert.equal(result.status, "matched");
  assert.equal(result.aaSlug, "gemini-2-5-flash");
});

// =============================================================================
// matchModelLlm — Display name match
// =============================================================================

test("Display name matches when slug-based fails", () => {
  const entries: AaLlmEntry[] = [
    { slug: "glm-4-5-air", name: "GLM-4.5-Air", creatorSlug: "zai" },
  ];
  const index = buildAaIndex(entries);
  // Raw slug "totally-different" won't match, but display name "GLM 4.5 Air" normalizes to "glm-4-5-air"
  const or: OrModelInput = {
    id: "z-ai/totally-different-slug",
    name: "Z.ai: GLM 4.5 Air",
  };
  const result = matchModelLlm(or, index);
  assert.equal(result.status, "matched");
  assert.equal(result.aaSlug, "glm-4-5-air");
  assert.equal(result.rule, "display_name_exact");
});

// =============================================================================
// matchModel — Legacy compatibility (batch matching)
// =============================================================================

test("matchModel returns manual override for genuine name mismatch", () => {
  const llmEntries: AaLlmEntry[] = [
    { slug: "deepseek-v3", creatorSlug: "deepseek" },
  ];
  const or: OrModelInput = {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek Chat",
  };
  const result = matchModel(or, llmEntries, []);
  assert.ok(result);
  assert.equal(result.strategy, "manual");
  assert.equal(result.confidence, 1.0);
  assert.equal(result.aaLlmSlug, "deepseek-v3");
});

test("matchModel returns null for completely unknown provider/model", () => {
  const or: OrModelInput = {
    id: "unknown-vendor/mystery-model",
    name: "Mystery Model",
  };
  const result = matchModel(or, [], []);
  assert.equal(result, null);
});

test("matchModel returns image match when LLM match fails", () => {
  const llmEntries: AaLlmEntry[] = [];
  const imageEntries: AaImageEntry[] = [{ slug: "flux-1-schnell" }];
  const or: OrModelInput = {
    id: "bfl/flux-1-schnell",
    name: "FLUX.1 Schnell",
  };
  const result = matchModel(or, llmEntries, imageEntries);
  assert.ok(result);
  assert.equal(result.aaImageSlug, "flux-1-schnell");
});

// =============================================================================
// matchModelImage
// =============================================================================

test("matchModelImage matches by exact normalized slug", () => {
  const imageEntries: AaImageEntry[] = [
    { slug: "flux-1-schnell" },
    { slug: "dall-e-3" },
  ];
  assert.equal(matchModelImage("bfl/flux-1-schnell", imageEntries), "flux-1-schnell");
});

test("matchModelImage returns undefined for unknown model", () => {
  assert.equal(matchModelImage("unknown/model", []), undefined);
});

// =============================================================================
// buildSlugIndex
// =============================================================================

test("buildSlugIndex creates a map keyed by slug", () => {
  const entries = [
    { slug: "a", value: 1 },
    { slug: "b", value: 2 },
  ];
  const index = buildSlugIndex(entries);
  assert.equal(index.size, 2);
  assert.deepEqual(index.get("a"), { slug: "a", value: 1 });
});

test("buildSlugIndex last entry wins for duplicate slugs", () => {
  const entries = [
    { slug: "a", value: 1 },
    { slug: "a", value: 2 },
  ];
  const index = buildSlugIndex(entries);
  assert.equal(index.size, 1);
  assert.deepEqual(index.get("a"), { slug: "a", value: 2 });
});

// =============================================================================
// Manual overrides integrity
// =============================================================================

test("all manual overrides have matching openRouterId key", () => {
  for (const [key, override] of Object.entries(MANUAL_OVERRIDES)) {
    assert.equal(key, override.openRouterId, `Key mismatch: ${key}`);
  }
});

test("all manual overrides have at least one AA slug", () => {
  for (const [key, override] of Object.entries(MANUAL_OVERRIDES)) {
    const hasSlug = override.aaLlmSlug || override.aaImageSlug;
    assert.ok(hasSlug, `Override ${key} has no AA slug`);
  }
});

// =============================================================================
// GPT-OSS-120B exact slug test (from spec Example 1)
// =============================================================================

test("GPT-OSS-120B exact match ignoring :free", () => {
  const entries: AaLlmEntry[] = [
    { slug: "gpt-oss-120b", creatorSlug: "openai" },
    { slug: "gpt-oss-120b-low", creatorSlug: "openai" },
  ];
  const index = buildAaIndex(entries);
  const or: OrModelInput = {
    id: "openai/gpt-oss-120b:free",
    name: "OpenAI: gpt-oss-120B (free)",
  };
  const result = matchModelLlm(or, index);
  assert.equal(result.status, "matched");
  assert.equal(result.aaSlug, "gpt-oss-120b");
  assert.equal(result.rule, "exact_slug");
});

// =============================================================================
// GPT-5.2 family: OR without mode → base, OR with reasoning → reasoning sibling
// =============================================================================

test("GPT-5.2 without mode token prefers base over reasoning/codex/medium", () => {
  const entries: AaLlmEntry[] = [
    { slug: "gpt-5-2", creatorSlug: "openai" },
    { slug: "gpt-5-2-non-reasoning", creatorSlug: "openai" },
    { slug: "gpt-5-2-medium", creatorSlug: "openai" },
    { slug: "gpt-5-2-codex", creatorSlug: "openai" },
  ];
  const index = buildAaIndex(entries);
  const or: OrModelInput = {
    id: "openai/gpt-5.2",
    name: "OpenAI: GPT-5.2",
    canonicalSlug: "openai/gpt-5.2-20260601",
  };
  const result = matchModelLlm(or, index);
  assert.equal(result.status, "matched");
  assert.equal(result.aaSlug, "gpt-5-2");
});
