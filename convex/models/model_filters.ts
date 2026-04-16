// convex/models/model_filters.ts
// =============================================================================
// Centralised model eligibility predicates. Every query/scoring function that
// decides whether a model is "visible" should use these helpers so the rules
// stay consistent across listModels, listModelSummaries, guidance scoring, etc.
// =============================================================================

// -- Provider exclusion -------------------------------------------------------
// Re-exported from provider_filters.ts (canonical location) so callers can
// import everything from one file.
export {
  filterExcludedOpenRouterProviders,
  isExcludedOpenRouterProvider,
} from "./provider_filters";

// -- Context-length threshold -------------------------------------------------

/** Minimum context length (tokens) a model must have to appear in the app. */
const MIN_CONTEXT_LENGTH = 100_000;

/** Google models have a lower threshold — many capable models are 32K–65K. */
const MIN_CONTEXT_LENGTH_GOOGLE = 32_000;

export function meetsMinContext(
  contextLength: number | undefined,
  provider: string | undefined,
): boolean {
  const min =
    provider === "google" ? MIN_CONTEXT_LENGTH_GOOGLE : MIN_CONTEXT_LENGTH;
  return (contextLength ?? 0) >= min;
}

// -- Price cap ----------------------------------------------------------------

/**
 * Maximum output price per 1M tokens. Models above this threshold are
 * extremely expensive speciality endpoints (e.g. image generation at $60/1M)
 * that aren't useful for general chat.
 */
const MAX_OUTPUT_PRICE_PER_1M = 50;

export function meetsMaxPrice(
  outputPricePer1M: number | undefined,
): boolean {
  if (outputPricePer1M === undefined) return true; // unknown price → keep
  return outputPricePer1M <= MAX_OUTPUT_PRICE_PER_1M;
}

// -- Composite eligibility check ----------------------------------------------

/** Returns true if a model passes all eligibility filters. */
export function isEligibleModel(model: {
  provider?: string | null;
  contextLength?: number;
  outputPricePer1M?: number;
  supportsVideo?: boolean;
}): boolean {
  // Provider exclusion is handled separately (filterExcludedOpenRouterProviders)
  // because it operates on the array level. This function covers the remaining
  // per-model predicates.

  // Video generation models (Sora, Seedance, Veo, etc.) don't have a context
  // window or token pricing — they charge per video second/token. Exempt them
  // from both context-length and price filters.
  if (model.supportsVideo) return true;

  return (
    meetsMinContext(model.contextLength, model.provider ?? undefined) &&
    meetsMaxPrice(model.outputPricePer1M)
  );
}
