// convex/lib/compaction_constants.ts
// =============================================================================
// Compaction thresholds and configuration for the context compaction system.
//
// The compaction system detects when context is about to overflow (or the
// Convex action timeout is approaching) during tool-call loops and
// automatically compresses conversation history so generation can continue.
// =============================================================================

export const COMPACTION = {
  /** Buffer before 10-min action timeout to trigger compaction (ms). */
  ACTION_TIMEOUT_BUFFER_MS: 3 * 60 * 1000, // 3 minutes → triggers at 7 min elapsed

  /** Fraction of model's context limit at which to trigger compaction. */
  CONTEXT_OVERFLOW_THRESHOLD: 0.85,

  /** Max number of compaction+continue cycles per generation. */
  MAX_CONTINUATIONS: 5,

  /** Max tokens for the compaction summary response. */
  COMPACTION_MAX_TOKENS: 2000,

  /** Temperature for compaction model (deterministic summaries). */
  COMPACTION_TEMPERATURE: 0,

  /** Token count below which tool outputs from older rounds are pruned first. */
  PRUNE_PROTECT_TOKENS: 40_000,

  /** Minimum token savings required for pruning to be worthwhile. */
  PRUNE_MINIMUM_SAVINGS: 20_000,

  /** Convex action timeout in ms (10 minutes). */
  ACTION_TIMEOUT_MS: 10 * 60 * 1000,
} as const;
