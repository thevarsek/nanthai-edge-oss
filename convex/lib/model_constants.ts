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
  autonomousConsensus: "openai/gpt-4.1-nano",
  /** Safety-net model when the primary model fails (rate-limit, outage). */
  autonomousFallback: "openai/gpt-4.1-mini",
  /** Embedding model for memory vector search. */
  embedding: "openai/text-embedding-3-small",
  memoryAlwaysOnLimit: 10,
} as const;
