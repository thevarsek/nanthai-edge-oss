// convex/lib/model_constants.ts
// =============================================================================
// Central model IDs used by backend workflows/actions.
// Keep non-user-editable model defaults in one place.
// Client fallbacks should stay aligned with these values.
// =============================================================================

export const MODEL_IDS = {
  appDefault: "openai/gpt-5.6-terra",
  advisorDispatcher: "openai/gpt-5.6-luna",
  titleGeneration: "openai/gpt-5.6-luna",
  memoryExtraction: "openai/gpt-5.6-luna",
  memoryExtractionFallback: "openai/gpt-5-mini",
  memoryImportExtraction: "openai/gpt-5.6-luna",
  pdfOcrExtraction: "openai/gpt-5.6-luna",
  searchQueryGeneration: "openai/gpt-5.6-luna",
  searchResearchOrchestration: "openai/gpt-5.6-luna",
  collaborationScheduler: "openai/gpt-5.6-luna",
  compaction: "openai/gpt-5.6-luna",
  textToSpeech: "openai/gpt-audio-mini",
  searchPerplexity: {
    quick: "perplexity/sonar",
    thorough: "perplexity/sonar-pro",
    comprehensive: "perplexity/sonar-pro-search",
  },
  /** Cheap model for autonomous consensus detection (YES/NO). */
  autonomousConsensus: "openai/gpt-5.6-luna",
  /** Safety-net model when the primary model fails (rate-limit, outage). */
  autonomousFallback: "openai/gpt-5-nano",
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
 * We intentionally do NOT set `preferred_max_latency` here. OpenRouter treats
 * that field as a rolling performance preference: endpoints outside the
 * threshold are deprioritized, not excluded. Sorting alone gives this path the
 * simpler policy we want — try the lowest-latency eligible provider first —
 * while avoiding another routing preference whose value has not been measured
 * against NanthAI production traffic.
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
