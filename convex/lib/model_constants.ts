// convex/lib/model_constants.ts
// =============================================================================
// Central model IDs used by backend workflows/actions.
// Keep non-user-editable model defaults in one place.
// Client fallbacks should stay aligned with these values.
// =============================================================================

export const MODEL_IDS = {
  appDefault: "openai/gpt-5.4",
  titleGeneration: "openai/gpt-4.1-mini",
  memoryExtraction: "openai/gpt-4.1-mini",
  memoryExtractionFallback: "openai/gpt-4.1",
  memoryImportExtraction: "openai/gpt-4.1-mini",
  searchQueryGeneration: "openai/gpt-5-mini",
  searchResearchOrchestration: "openai/gpt-5-mini",
  compaction: "google/gemini-3.1-flash-lite-preview",
  searchPerplexity: {
    quick: "perplexity/sonar",
    thorough: "perplexity/sonar-pro",
    comprehensive: "perplexity/sonar-deep-research",
  },
  /** Cheap model for autonomous consensus detection (YES/NO). */
  autonomousConsensus: "openai/gpt-5-nano",
  /** Safety-net model when the primary model fails (rate-limit, outage). */
  autonomousFallback: "openai/gpt-4.1-mini",
  /** Embedding model for memory vector search. */
  embedding: "openai/text-embedding-3-small",
  memoryAlwaysOnLimit: 10,
} as const;

/**
 * Default OpenRouter provider selection strategy applied to every chat
 * request. `sort: "latency"` asks OpenRouter to route to the provider with the
 * lowest observed TTFT for the requested model. Callers may override by
 * supplying their own `provider` block — merging happens in
 * `lib/openrouter_request.buildRequestBody`, so ZDR and other caller-provided
 * fields are preserved.
 *
 * We intentionally do NOT set `preferred_max_latency` here: a hard p90 cap
 * filters out endpoints whose recent p90 exceeds the threshold, which can
 * collapse the endpoint set to zero (especially when combined with top-level
 * `cache_control` that already restricts routing to a single provider, e.g.
 * Anthropic-native), producing a 404 "No endpoints found". Sorting alone is
 * sufficient — OpenRouter picks the lowest-latency provider without hard
 * exclusions.
 *
 * Set this constant to `null` to fully disable provider sorting (one-line
 * revert if we observe regressions).
 */
export const OPENROUTER_DEFAULT_PROVIDER_SORT: {
  sort: "latency" | "throughput" | "price";
  preferred_max_latency?: { p50?: number; p90?: number; p99?: number };
} | null = {
  sort: "latency",
};
