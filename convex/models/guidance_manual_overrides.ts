// convex/models/guidance_manual_overrides.ts
// =============================================================================
// Manual override map for OpenRouter ↔ Artificial Analysis ID matching.
//
// Used for known naming mismatches and high-traffic models where automatic
// slug/name matching would fail or be ambiguous.
// =============================================================================

export interface ManualOverride {
  openRouterId: string;
  aaLlmSlug?: string;
  aaImageSlug?: string;
  notes?: string;
}

/**
 * Static override map keyed by OpenRouter model ID.
 *
 * Most matching is handled automatically by `canonicalizeSlug()` in
 * guidance_matching.ts (dots→hyphens, suffix stripping, provider scoping).
 *
 * Add entries here ONLY when:
 * - The OpenRouter slug genuinely differs from the AA slug in a way
 *   canonical slug matching cannot resolve (e.g. deepseek-chat → deepseek-v3)
 * - A model variant should map to a different AA entry (e.g. o4-mini-high → o4-mini)
 */
export const MANUAL_OVERRIDES: Record<string, ManualOverride> = {
  // -- OpenAI --
  "openai/o4-mini-high": {
    openRouterId: "openai/o4-mini-high",
    aaLlmSlug: "o4-mini",
    notes: "High reasoning variant maps to same benchmark model",
  },

  // -- DeepSeek --
  "deepseek/deepseek-chat": {
    openRouterId: "deepseek/deepseek-chat",
    aaLlmSlug: "deepseek-v3",
    notes: "OpenRouter uses 'chat' but AA uses version name",
  },

  // -- Mistral --
  "mistralai/mistral-large": {
    openRouterId: "mistralai/mistral-large",
    aaLlmSlug: "mistral-large-2",
    notes: "AA appends version suffix",
  },
};

/**
 * Look up a manual override by OpenRouter model ID.
 */
export function getManualOverride(
  openRouterId: string,
): ManualOverride | undefined {
  return MANUAL_OVERRIDES[openRouterId];
}
