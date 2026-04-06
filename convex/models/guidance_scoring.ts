// convex/models/guidance_scoring.ts
// =============================================================================
// Score derivation: normalizes benchmark metrics and computes sort scores +
// labels for each matched model. All functions are pure for testability.
// =============================================================================

// -- Types --------------------------------------------------------------------

export interface BenchmarkInputLlm {
  intelligenceIndex?: number;
  codingIndex?: number;
  mathIndex?: number;
  agenticIndex?: number;
  speedTokensPerSecond?: number;
  timeToFirstTokenSeconds?: number;
  aaBlendedPricePer1M?: number;
}

export interface BenchmarkInputImage {
  elo?: number;
  rank?: number;
}

export interface ModelPricingInput {
  /** OpenRouter total price per 1M tokens (input + output). */
  orTotalPricePer1M?: number;
  /** AA blended price per 1M tokens. */
  aaBlendedPricePer1M?: number;
}

export interface ModelContextInput {
  contextLength?: number;
}

export interface NormalizedMetrics {
  I: number; // intelligenceIndex
  C: number; // codingIndex (fallback: I * 0.70)
  A: number; // agenticIndex (fallback: I * 0.75)
  S: number; // speedTokensPerSecond
  T: number; // inverse log(timeToFirstTokenSeconds)
  P: number; // inverse log(price)
  X: number; // contextLength
  E: number; // text-to-image elo
  R: number; // inverse rank
}

export interface DerivedScores {
  recommended?: number;
  coding?: number;
  research?: number;
  fast?: number;
  value?: number;
  image?: number;
}

export interface DerivedGuidanceOutput {
  labels: string[];
  primaryLabel?: string;
  supportedIntents: string[];
  scores: DerivedScores;
  lastDerivedAt: number;
}

export interface NormalizationPool {
  intelligence: { min: number; max: number };
  coding: { min: number; max: number };
  agentic: { min: number; max: number };
  speed: { min: number; max: number };
  ttftLog: { min: number; max: number };
  priceLog: { min: number; max: number };
  context: { min: number; max: number };
  imageElo: { min: number; max: number };
  imageRank: { min: number; max: number };
}

// -- Normalization pool helpers -----------------------------------------------

/**
 * Min-max normalize: higher raw value = higher score (0..1).
 */
export function normHigher(
  value: number,
  min: number,
  max: number,
): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Min-max normalize inversely: lower raw value = higher score (0..1).
 */
export function normLower(
  value: number,
  min: number,
  max: number,
): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (max - value) / (max - min)));
}

/**
 * Log-transform a value before inverse normalization.
 * Reduces outlier skew for price and TTFT.
 */
export function logTransform(value: number): number {
  return Math.log1p(Math.max(0, value));
}

/**
 * Compute min/max from an array of numbers, ignoring undefined.
 */
export function computeMinMax(
  values: (number | undefined)[],
): { min: number; max: number } {
  const defined = values.filter((v): v is number => v !== undefined);
  if (defined.length === 0) return { min: 0, max: 0 };
  return {
    min: Math.min(...defined),
    max: Math.max(...defined),
  };
}

/**
 * Build a normalization pool from arrays of model data.
 */
export function buildNormalizationPool(
  llms: BenchmarkInputLlm[],
  images: BenchmarkInputImage[],
  prices: (number | undefined)[],
  contexts: (number | undefined)[],
): NormalizationPool {
  return {
    intelligence: computeMinMax(llms.map((l) => l.intelligenceIndex)),
    coding: computeMinMax(llms.map((l) => l.codingIndex)),
    agentic: computeMinMax(llms.map((l) => l.agenticIndex)),
    speed: computeMinMax(llms.map((l) => l.speedTokensPerSecond)),
    ttftLog: computeMinMax(
      llms
        .map((l) => l.timeToFirstTokenSeconds)
        .filter((v): v is number => v !== undefined)
        .map(logTransform),
    ),
    priceLog: computeMinMax(
      prices
        .filter((v): v is number => v !== undefined)
        .map(logTransform),
    ),
    context: computeMinMax(contexts),
    imageElo: computeMinMax(images.map((i) => i.elo)),
    imageRank: computeMinMax(images.map((i) => i.rank)),
  };
}

// -- Score computation --------------------------------------------------------

/**
 * Normalize a single model's metrics against the pool ranges.
 */
export function normalizeMetrics(
  llm: BenchmarkInputLlm | undefined,
  image: BenchmarkInputImage | undefined,
  pricing: ModelPricingInput,
  context: ModelContextInput,
  pool: NormalizationPool,
): NormalizedMetrics {
  const rawI = llm?.intelligenceIndex;
  const rawC = llm?.codingIndex;
  const rawA = llm?.agenticIndex;
  const rawS = llm?.speedTokensPerSecond;
  const rawT = llm?.timeToFirstTokenSeconds;

  const I = rawI !== undefined
    ? normHigher(rawI, pool.intelligence.min, pool.intelligence.max)
    : 0;

  const C = rawC !== undefined
    ? normHigher(rawC, pool.coding.min, pool.coding.max)
    : I * 0.70;

  const A = rawA !== undefined
    ? normHigher(rawA, pool.agentic.min, pool.agentic.max)
    : I * 0.75;

  const S = rawS !== undefined
    ? normHigher(rawS, pool.speed.min, pool.speed.max)
    : 0;

  const logT = rawT !== undefined ? logTransform(rawT) : undefined;
  const T = logT !== undefined
    ? normLower(logT, pool.ttftLog.min, pool.ttftLog.max)
    : 0;

  // Price: prefer OR total, fallback to AA blended
  const priceRaw = pricing.orTotalPricePer1M ?? pricing.aaBlendedPricePer1M;
  const logP = priceRaw !== undefined ? logTransform(priceRaw) : undefined;
  const P = logP !== undefined
    ? normLower(logP, pool.priceLog.min, pool.priceLog.max)
    : 0.30; // neutral fallback

  const X = context.contextLength !== undefined
    ? normHigher(
        context.contextLength,
        pool.context.min,
        pool.context.max,
      )
    : 0;

  const E = image?.elo !== undefined
    ? normHigher(image.elo, pool.imageElo.min, pool.imageElo.max)
    : 0;

  const R = image?.rank !== undefined
    ? normLower(image.rank, pool.imageRank.min, pool.imageRank.max)
    : 0;

  return { I, C, A, S, T, P, X, E, R };
}

/**
 * Compute derived sort scores from normalized metrics.
 */
export function computeScores(
  m: NormalizedMetrics,
  hasLlm: boolean,
  hasImage: boolean,
): DerivedScores {
  const scores: DerivedScores = {};

  if (hasLlm) {
    scores.recommended =
      0.50 * m.I + 0.15 * m.A + 0.10 * m.S + 0.10 * m.T + 0.15 * m.P;
    scores.coding =
      0.55 * m.C + 0.20 * m.I + 0.10 * m.A + 0.10 * m.S + 0.05 * m.P;
    scores.research =
      0.40 * m.I + 0.25 * m.A + 0.20 * m.X + 0.05 * m.S + 0.10 * m.P;
    scores.fast =
      0.45 * m.S + 0.30 * m.T + 0.15 * m.I + 0.10 * m.P;
    scores.value =
      0.40 * m.I + 0.35 * m.P + 0.15 * m.S + 0.10 * m.T;
  }

  if (hasImage) {
    scores.image = 0.80 * m.E + 0.20 * m.R;
  }

  return scores;
}

/**
 * Full derivation pipeline for a single model.
 * If ranks are provided (from batch computation), rank-based labels are used.
 */
export function deriveGuidance(
  llm: BenchmarkInputLlm | undefined,
  image: BenchmarkInputImage | undefined,
  pricing: ModelPricingInput,
  context: ModelContextInput,
  pool: NormalizationPool,
  ranks?: ModelRanks,
): DerivedGuidanceOutput {
  const normalized = normalizeMetrics(llm, image, pricing, context, pool);
  const hasLlm = llm !== undefined;
  const hasImage = image !== undefined;
  const scores = computeScores(normalized, hasLlm, hasImage);
  const { labels, primaryLabel } = deriveLabels(scores, ranks);
  const supportedIntents = deriveSupportedIntents(scores);

  return {
    labels,
    primaryLabel,
    supportedIntents,
    scores,
    lastDerivedAt: Date.now(),
  };
}

import { deriveLabels, deriveSupportedIntents, type ModelRanks } from "./guidance_scoring_labels";

// Re-export for backward compatibility
export { deriveLabels, deriveSupportedIntents, computeAllRanks } from "./guidance_scoring_labels";
export type { ModelRanks } from "./guidance_scoring_labels";

// -- Label derivation ---------------------------------------------------------
// See guidance_scoring_labels.ts for deriveLabels and deriveSupportedIntents.
