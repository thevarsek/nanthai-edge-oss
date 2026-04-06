import { ChatRequestParameters } from "./openrouter_types";

/**
 * Apply per-model parameter gating based on the model's supportedParameters.
 * Mirrors the iOS `applyPerModelModalities` logic.
 */
export function gateParameters(
  params: ChatRequestParameters,
  supportedParameters?: string[],
  hasImageGeneration?: boolean,
  hasReasoning?: boolean,
): ChatRequestParameters {
  const gated = { ...params };

  // Image generation gating
  if (hasImageGeneration) {
    // Prefer image-only output for image-generation models.
    // This reduces flaky mixed text/image responses and avoids text noise.
    gated.modalities = ["image"];
    gated.temperature = null;
    gated.includeReasoning = null;
    gated.reasoningEffort = null;
  } else {
    gated.modalities = null;
    gated.imageConfig = null;
  }

  // Authoritative supportedParameters list
  if (supportedParameters && supportedParameters.length > 0) {
    if (!supportedParameters.includes("temperature")) {
      gated.temperature = null;
    }
    if (!supportedParameters.includes("max_tokens")) {
      gated.maxTokens = null;
    }
    if (!supportedParameters.includes("include_reasoning")) {
      gated.includeReasoning = null;
    }
    if (!supportedParameters.includes("reasoning")) {
      gated.reasoningEffort = null;
    }
  } else {
    // Fallback: boolean capability flags
    if (!hasReasoning) {
      gated.includeReasoning = hasImageGeneration ? null : false;
      gated.reasoningEffort = null;
    }
    if (hasImageGeneration) {
      gated.temperature = null;
    }
  }

  return gated;
}
