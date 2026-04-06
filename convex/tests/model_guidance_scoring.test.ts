import assert from "node:assert/strict";
import test from "node:test";

import {
  normHigher,
  normLower,
  logTransform,
  computeMinMax,
  buildNormalizationPool,
  normalizeMetrics,
  computeScores,
  deriveLabels,
  deriveSupportedIntents,
  computeAllRanks,
  deriveGuidance,
  type NormalizationPool,
  type NormalizedMetrics,
  type BenchmarkInputLlm,
  type BenchmarkInputImage,
  type DerivedScores,
} from "../models/guidance_scoring";

import type { ModelRanks } from "../models/guidance_scoring_labels";

import {
  computeWizardTextScore,
  computeWizardImageScore,
  getTrendHint,
  taskToOpenRouterCategory,
  taskToPickerSortKey,
} from "../models/guidance_scoring_wizard";

// =============================================================================
// normHigher / normLower
// =============================================================================

test("normHigher normalizes within 0..1 range", () => {
  assert.equal(normHigher(50, 0, 100), 0.5);
  assert.equal(normHigher(0, 0, 100), 0);
  assert.equal(normHigher(100, 0, 100), 1);
});

test("normHigher clamps out-of-range values", () => {
  assert.equal(normHigher(-10, 0, 100), 0);
  assert.equal(normHigher(110, 0, 100), 1);
});

test("normHigher returns 0.5 when min === max", () => {
  assert.equal(normHigher(5, 5, 5), 0.5);
});

test("normLower inverts the scale", () => {
  assert.equal(normLower(0, 0, 100), 1);
  assert.equal(normLower(100, 0, 100), 0);
  assert.equal(normLower(50, 0, 100), 0.5);
});

test("normLower returns 0.5 when min === max", () => {
  assert.equal(normLower(5, 5, 5), 0.5);
});

// =============================================================================
// logTransform
// =============================================================================

test("logTransform returns log1p for positive values", () => {
  assert.ok(logTransform(0) === 0);
  assert.ok(logTransform(1) > 0);
  // log1p(e-1) ≈ 1
  const result = logTransform(Math.E - 1);
  assert.ok(Math.abs(result - 1) < 0.001);
});

test("logTransform clamps negatives to 0", () => {
  assert.equal(logTransform(-5), 0);
});

// =============================================================================
// computeMinMax
// =============================================================================

test("computeMinMax handles mixed values with undefined", () => {
  const result = computeMinMax([10, undefined, 5, 20, undefined]);
  assert.equal(result.min, 5);
  assert.equal(result.max, 20);
});

test("computeMinMax returns 0,0 for empty array", () => {
  const result = computeMinMax([]);
  assert.equal(result.min, 0);
  assert.equal(result.max, 0);
});

test("computeMinMax returns 0,0 for all-undefined", () => {
  const result = computeMinMax([undefined, undefined]);
  assert.equal(result.min, 0);
  assert.equal(result.max, 0);
});

test("computeMinMax handles single value", () => {
  const result = computeMinMax([42]);
  assert.equal(result.min, 42);
  assert.equal(result.max, 42);
});

// =============================================================================
// buildNormalizationPool
// =============================================================================

function makeLlm(overrides: Partial<BenchmarkInputLlm> = {}): BenchmarkInputLlm {
  return {
    intelligenceIndex: 70,
    codingIndex: 60,
    agenticIndex: 50,
    speedTokensPerSecond: 100,
    timeToFirstTokenSeconds: 0.5,
    aaBlendedPricePer1M: 10,
    ...overrides,
  };
}

test("buildNormalizationPool computes ranges from inputs", () => {
  const llms = [
    makeLlm({ intelligenceIndex: 40, speedTokensPerSecond: 50 }),
    makeLlm({ intelligenceIndex: 80, speedTokensPerSecond: 200 }),
  ];
  const images: BenchmarkInputImage[] = [
    { elo: 1000, rank: 5 },
    { elo: 1200, rank: 1 },
  ];
  const prices = [5, 20];
  const contexts = [32000, 128000];

  const pool = buildNormalizationPool(llms, images, prices, contexts);
  assert.equal(pool.intelligence.min, 40);
  assert.equal(pool.intelligence.max, 80);
  assert.equal(pool.speed.min, 50);
  assert.equal(pool.speed.max, 200);
  assert.equal(pool.imageElo.min, 1000);
  assert.equal(pool.imageElo.max, 1200);
  assert.equal(pool.imageRank.min, 1);
  assert.equal(pool.imageRank.max, 5);
  assert.equal(pool.context.min, 32000);
  assert.equal(pool.context.max, 128000);
});

// =============================================================================
// normalizeMetrics
// =============================================================================

function makePool(): NormalizationPool {
  return {
    intelligence: { min: 0, max: 100 },
    coding: { min: 0, max: 100 },
    agentic: { min: 0, max: 100 },
    speed: { min: 0, max: 200 },
    ttftLog: { min: 0, max: logTransform(5) },
    priceLog: { min: 0, max: logTransform(100) },
    context: { min: 0, max: 200000 },
    imageElo: { min: 900, max: 1300 },
    imageRank: { min: 1, max: 20 },
  };
}

test("normalizeMetrics produces values in 0..1 range for LLM", () => {
  const pool = makePool();
  const llm = makeLlm({
    intelligenceIndex: 50,
    codingIndex: 75,
    agenticIndex: 60,
    speedTokensPerSecond: 100,
    timeToFirstTokenSeconds: 1.0,
  });
  const m = normalizeMetrics(
    llm,
    undefined,
    { orTotalPricePer1M: 10 },
    { contextLength: 100000 },
    pool,
  );

  assert.equal(m.I, 0.5);
  assert.equal(m.C, 0.75);
  assert.equal(m.A, 0.6);
  assert.equal(m.S, 0.5);
  assert.ok(m.T >= 0 && m.T <= 1, `T=${m.T} out of range`);
  assert.ok(m.P >= 0 && m.P <= 1, `P=${m.P} out of range`);
  assert.equal(m.X, 0.5);
  // No image data
  assert.equal(m.E, 0);
  assert.equal(m.R, 0);
});

test("normalizeMetrics uses fallbacks when coding/agentic missing", () => {
  const pool = makePool();
  const llm: BenchmarkInputLlm = {
    intelligenceIndex: 80,
    speedTokensPerSecond: 100,
    timeToFirstTokenSeconds: 0.5,
  };
  const m = normalizeMetrics(
    llm,
    undefined,
    { orTotalPricePer1M: 5 },
    { contextLength: 50000 },
    pool,
  );

  // C fallback: I * 0.70
  assert.equal(m.C, m.I * 0.70);
  // A fallback: I * 0.75
  assert.equal(m.A, m.I * 0.75);
});

test("normalizeMetrics handles image-only model", () => {
  const pool = makePool();
  const image: BenchmarkInputImage = { elo: 1100, rank: 5 };
  const m = normalizeMetrics(
    undefined,
    image,
    {},
    {},
    pool,
  );

  assert.equal(m.I, 0);
  assert.equal(m.C, 0);
  assert.ok(m.E > 0, "E should be positive for image model");
  assert.ok(m.R > 0, "R should be positive for ranked image model");
});

// =============================================================================
// computeScores
// =============================================================================

test("computeScores produces LLM scores for LLM model", () => {
  const m: NormalizedMetrics = {
    I: 0.8, C: 0.9, A: 0.7, S: 0.6, T: 0.5, P: 0.4, X: 0.3, E: 0, R: 0,
  };
  const scores = computeScores(m, true, false);

  assert.ok(scores.recommended !== undefined);
  assert.ok(scores.coding !== undefined);
  assert.ok(scores.research !== undefined);
  assert.ok(scores.fast !== undefined);
  assert.ok(scores.value !== undefined);
  assert.equal(scores.image, undefined);
});

test("computeScores produces image score for image model", () => {
  const m: NormalizedMetrics = {
    I: 0, C: 0, A: 0, S: 0, T: 0, P: 0, X: 0, E: 0.9, R: 0.8,
  };
  const scores = computeScores(m, false, true);

  assert.equal(scores.recommended, undefined);
  assert.ok(scores.image !== undefined);
  assert.ok(scores.image! > 0);
});

test("computeScores formula: recommended emphasizes intelligence", () => {
  const highI: NormalizedMetrics = {
    I: 1.0, C: 0.5, A: 0.5, S: 0.5, T: 0.5, P: 0.5, X: 0.5, E: 0, R: 0,
  };
  const lowI: NormalizedMetrics = {
    I: 0.2, C: 0.5, A: 0.5, S: 0.5, T: 0.5, P: 0.5, X: 0.5, E: 0, R: 0,
  };
  const scoresHigh = computeScores(highI, true, false);
  const scoresLow = computeScores(lowI, true, false);

  assert.ok(
    scoresHigh.recommended! > scoresLow.recommended!,
    "Higher intelligence should yield higher recommended score",
  );
});

test("computeScores formula: fast emphasizes speed + TTFT", () => {
  const fast: NormalizedMetrics = {
    I: 0.5, C: 0.5, A: 0.5, S: 1.0, T: 1.0, P: 0.5, X: 0.5, E: 0, R: 0,
  };
  const slow: NormalizedMetrics = {
    I: 0.5, C: 0.5, A: 0.5, S: 0.1, T: 0.1, P: 0.5, X: 0.5, E: 0, R: 0,
  };
  const scoresFast = computeScores(fast, true, false);
  const scoresSlow = computeScores(slow, true, false);

  assert.ok(
    scoresFast.fast! > scoresSlow.fast!,
    "Higher speed/TTFT should yield higher fast score",
  );
});

// =============================================================================
// deriveLabels (rank-based)
// =============================================================================

test("deriveLabels returns empty when no ranks provided", () => {
  const scores = {
    recommended: 0.8,
    coding: 0.9,
    research: 0.7,
  };
  const { labels, primaryLabel } = deriveLabels(scores);
  assert.equal(labels.length, 0);
  assert.equal(primaryLabel, undefined);
});

test("deriveLabels returns empty when ranks are all outside top 3", () => {
  const scores: DerivedScores = { recommended: 0.5, coding: 0.4 };
  const ranks: ModelRanks = { recommended: 10, coding: 8 };
  const { labels, primaryLabel } = deriveLabels(scores, ranks);
  assert.equal(labels.length, 0);
  assert.equal(primaryLabel, undefined);
});

test("deriveLabels returns rank-1 semantic key for rank 1", () => {
  const scores: DerivedScores = { coding: 0.95 };
  const ranks: ModelRanks = { coding: 1 };
  const { labels, primaryLabel } = deriveLabels(scores, ranks);
  assert.equal(labels.length, 1);
  assert.equal(labels[0], "coding.best");
  assert.equal(primaryLabel, "coding.best");
});

test("deriveLabels returns topN semantic key for rank 2-3", () => {
  const scores: DerivedScores = { fast: 0.9 };
  const ranks: ModelRanks = { fast: 3 };
  const { labels, primaryLabel } = deriveLabels(scores, ranks);
  assert.equal(labels[0], "fast.top");
  assert.equal(primaryLabel, "fast.top");
});

test("deriveLabels returns nothing for rank outside top 3", () => {
  const scores: DerivedScores = { value: 0.7 };
  const ranks: ModelRanks = { value: 5 };
  const { labels, primaryLabel } = deriveLabels(scores, ranks);
  assert.equal(labels.length, 0);
  assert.equal(primaryLabel, undefined);
});

test("deriveLabels returns up to 2 labels sorted by best rank", () => {
  const scores: DerivedScores = {
    recommended: 0.8,
    coding: 0.9,
    research: 0.7,
    fast: 0.6,
  };
  const ranks: ModelRanks = {
    recommended: 4, // outside top 3 → excluded
    coding: 1,
    research: 3,
    fast: 2,
  };
  const { labels } = deriveLabels(scores, ranks);
  assert.equal(labels.length, 2);
  // Rank 1 first (coding), then rank 2 (fast)
  assert.equal(labels[0], "coding.best");
  assert.equal(labels[1], "fast.top");
});

test("deriveLabels uses priority order for same rank", () => {
  const scores: DerivedScores = {
    coding: 0.9,
    research: 0.85,
    fast: 0.8,
  };
  // All rank 1 — priority order decides: coding > research > fast
  const ranks: ModelRanks = { coding: 1, research: 1, fast: 1 };
  const { labels, primaryLabel } = deriveLabels(scores, ranks);
  assert.equal(primaryLabel, "coding.best");
  assert.equal(labels.length, 2);
  assert.equal(labels[0], "coding.best");
  assert.equal(labels[1], "research.best");
});

test("deriveLabels image label", () => {
  const scores: DerivedScores = { image: 0.95 };
  const ranks: ModelRanks = { image: 2 };
  const { labels, primaryLabel } = deriveLabels(scores, ranks);
  assert.equal(labels[0], "image.top");
  assert.equal(primaryLabel, "image.top");
});

// =============================================================================
// computeAllRanks
// =============================================================================

test("computeAllRanks computes per-category ranks", () => {
  const models = [
    { id: "a", scores: { recommended: 0.9, coding: 0.5 } as DerivedScores },
    { id: "b", scores: { recommended: 0.7, coding: 0.8 } as DerivedScores },
    { id: "c", scores: { recommended: 0.8, coding: 0.6 } as DerivedScores },
  ];
  const ranks = computeAllRanks(models);

  // recommended: a=0.9 (#1), c=0.8 (#2), b=0.7 (#3)
  assert.equal(ranks.get("a")!.recommended, 1);
  assert.equal(ranks.get("c")!.recommended, 2);
  assert.equal(ranks.get("b")!.recommended, 3);

  // coding: b=0.8 (#1), c=0.6 (#2), a=0.5 (#3)
  assert.equal(ranks.get("b")!.coding, 1);
  assert.equal(ranks.get("c")!.coding, 2);
  assert.equal(ranks.get("a")!.coding, 3);
});

test("computeAllRanks uses competition ranking for ties", () => {
  const models = [
    { id: "a", scores: { recommended: 0.9 } as DerivedScores },
    { id: "b", scores: { recommended: 0.9 } as DerivedScores },
    { id: "c", scores: { recommended: 0.7 } as DerivedScores },
  ];
  const ranks = computeAllRanks(models);

  // a and b tie at 0.9 → both rank 1, c rank 3 (not 2)
  assert.equal(ranks.get("a")!.recommended, 1);
  assert.equal(ranks.get("b")!.recommended, 1);
  assert.equal(ranks.get("c")!.recommended, 3);
});

test("computeAllRanks skips categories where model has no score", () => {
  const models = [
    { id: "llm", scores: { recommended: 0.8, coding: 0.7 } as DerivedScores },
    { id: "img", scores: { image: 0.9 } as DerivedScores },
  ];
  const ranks = computeAllRanks(models);

  assert.equal(ranks.get("llm")!.recommended, 1);
  assert.equal(ranks.get("llm")!.coding, 1);
  assert.equal(ranks.get("llm")!.image, undefined);
  assert.equal(ranks.get("img")!.image, 1);
  assert.equal(ranks.get("img")!.recommended, undefined);
});

test("computeAllRanks skips zero scores", () => {
  const models = [
    { id: "a", scores: { recommended: 0.8, coding: 0 } as DerivedScores },
    { id: "b", scores: { recommended: 0.6, coding: 0.5 } as DerivedScores },
  ];
  const ranks = computeAllRanks(models);
  // a has coding=0, should not be ranked
  assert.equal(ranks.get("a")!.coding, undefined);
  assert.equal(ranks.get("b")!.coding, 1);
});

test("computeAllRanks handles empty input", () => {
  const ranks = computeAllRanks([]);
  assert.equal(ranks.size, 0);
});

// =============================================================================
// deriveSupportedIntents
// =============================================================================

test("deriveSupportedIntents lists all score families present", () => {
  const scores = {
    recommended: 0.5,
    coding: 0.6,
    image: 0.7,
  };
  const intents = deriveSupportedIntents(scores);
  assert.ok(intents.includes("recommended"));
  assert.ok(intents.includes("coding"));
  assert.ok(intents.includes("image"));
  assert.ok(!intents.includes("fast"));
});

// =============================================================================
// deriveGuidance
// =============================================================================

test("deriveGuidance produces complete output for LLM model", () => {
  const pool = makePool();
  const llm = makeLlm({ intelligenceIndex: 80, codingIndex: 70 });

  const result = deriveGuidance(
    llm,
    undefined,
    { orTotalPricePer1M: 10 },
    { contextLength: 128000 },
    pool,
  );

  assert.ok(Array.isArray(result.labels));
  assert.ok(Array.isArray(result.supportedIntents));
  assert.ok(result.scores.recommended !== undefined);
  assert.ok(result.lastDerivedAt > 0);
});

test("deriveGuidance handles image-only model", () => {
  const pool = makePool();
  const image: BenchmarkInputImage = { elo: 1200, rank: 2 };

  const result = deriveGuidance(
    undefined,
    image,
    {},
    {},
    pool,
  );

  assert.ok(result.scores.image !== undefined);
  assert.equal(result.scores.recommended, undefined);
  assert.ok(result.supportedIntents.includes("image"));
});

// =============================================================================
// computeWizardTextScore
// =============================================================================

test("wizard text score varies by task and priority", () => {
  const m: NormalizedMetrics = {
    I: 0.8, C: 0.9, A: 0.7, S: 0.6, T: 0.5, P: 0.7, X: 0.5, E: 0, R: 0,
  };

  const codingQuality = computeWizardTextScore(m, "coding", "quality");
  const codingValue = computeWizardTextScore(m, "coding", "value");
  const everydaySpeed = computeWizardTextScore(m, "everydayHelp", "speed");

  // All should be positive
  assert.ok(codingQuality > 0);
  assert.ok(codingValue > 0);
  assert.ok(everydaySpeed > 0);

  // These should differ from each other
  assert.ok(codingQuality !== codingValue || codingQuality !== everydaySpeed);
});

test("wizard text score: coding quality emphasizes C metric", () => {
  const highC: NormalizedMetrics = {
    I: 0.5, C: 1.0, A: 0.5, S: 0.5, T: 0.5, P: 0.5, X: 0.5, E: 0, R: 0,
  };
  const lowC: NormalizedMetrics = {
    I: 0.5, C: 0.1, A: 0.5, S: 0.5, T: 0.5, P: 0.5, X: 0.5, E: 0, R: 0,
  };

  const scoreHigh = computeWizardTextScore(highC, "coding", "quality");
  const scoreLow = computeWizardTextScore(lowC, "coding", "quality");

  assert.ok(scoreHigh > scoreLow, "Higher C should yield higher coding score");
});

// =============================================================================
// computeWizardImageScore
// =============================================================================

test("wizard image score uses elo and rank", () => {
  const m: NormalizedMetrics = {
    I: 0, C: 0, A: 0, S: 0, T: 0, P: 0.5, X: 0, E: 0.9, R: 0.8,
  };

  const quality = computeWizardImageScore(m, "quality");
  const value = computeWizardImageScore(m, "value");

  assert.ok(quality > 0);
  assert.ok(value > 0);
  // Value formula includes price, quality doesn't
  assert.ok(quality !== value);
});

// =============================================================================
// getTrendHint
// =============================================================================

test("getTrendHint returns Popular now for rank 1-3", () => {
  const useCases = [{ category: "programming", returnedRank: 2 }];
  assert.equal(getTrendHint(useCases, "programming"), "Popular now");
});

test("getTrendHint returns Trending for rank 4-10", () => {
  const useCases = [{ category: "programming", returnedRank: 7 }];
  assert.equal(getTrendHint(useCases, "programming"), "Trending");
});

test("getTrendHint returns null for rank > 10", () => {
  const useCases = [{ category: "programming", returnedRank: 15 }];
  assert.equal(getTrendHint(useCases, "programming"), null);
});

test("getTrendHint returns null for mismatched category", () => {
  const useCases = [{ category: "programming", returnedRank: 1 }];
  assert.equal(getTrendHint(useCases, "science"), null);
});

test("getTrendHint returns null for undefined inputs", () => {
  assert.equal(getTrendHint(undefined, "programming"), null);
  assert.equal(getTrendHint([], undefined), null);
});

// =============================================================================
// taskToOpenRouterCategory
// =============================================================================

test("taskToOpenRouterCategory maps tasks to categories", () => {
  assert.equal(taskToOpenRouterCategory("coding"), "programming");
  assert.equal(taskToOpenRouterCategory("researchStudy"), "academia");
  assert.equal(taskToOpenRouterCategory("writingMarketing"), "marketing");
  assert.equal(taskToOpenRouterCategory("translation"), "translation");
  assert.equal(taskToOpenRouterCategory("everydayHelp"), "trivia");
});

test("taskToOpenRouterCategory returns undefined for images", () => {
  assert.equal(taskToOpenRouterCategory("images"), undefined);
});

// =============================================================================
// taskToPickerSortKey
// =============================================================================

test("taskToPickerSortKey maps tasks to sort keys", () => {
  assert.equal(taskToPickerSortKey("coding"), "coding");
  assert.equal(taskToPickerSortKey("researchStudy"), "research");
  assert.equal(taskToPickerSortKey("images"), "image");
  assert.equal(taskToPickerSortKey("everydayHelp"), "recommended");
});
