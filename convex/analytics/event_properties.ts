import type { OpenRouterUsage } from "../lib/openrouter_types";

type AnalyticsValue = string | number | boolean | null | undefined;
type AnalyticsProperties = Record<string, AnalyticsValue>;

export type OpenRouterFailureCategory =
  | "missing_api_key"
  | "invalid_api_key"
  | "insufficient_credits"
  | "model_unavailable"
  | "rate_limited"
  | "context_length_exceeded"
  | "timeout"
  | "cancelled"
  | "provider_error"
  | "unknown_error";

export function openRouterUsageAnalyticsProperties(
  usage?: OpenRouterUsage | null,
): AnalyticsProperties {
  return {
    prompt_tokens: usage?.promptTokens ?? null,
    completion_tokens: usage?.completionTokens ?? null,
    total_tokens: usage?.totalTokens ?? null,
    cost_usd: usage?.cost ?? null,
    upstream_cost_usd: usage?.upstreamInferenceCost ?? null,
    is_byok: usage?.isByok ?? null,
    cached_tokens: usage?.cachedTokens ?? null,
    cache_write_tokens: usage?.cacheWriteTokens ?? null,
    reasoning_tokens: usage?.reasoningTokens ?? null,
    audio_prompt_tokens: usage?.audioPromptTokens ?? null,
    audio_completion_tokens: usage?.audioCompletionTokens ?? null,
    image_tokens: usage?.imageCompletionTokens ?? null,
    video_tokens: usage?.videoTokens ?? null,
    web_search_requests: usage?.webSearchRequests ?? null,
    cache_discount_usd: usage?.cacheDiscount ?? null,
    upstream_prompt_cost_usd: usage?.upstreamInferencePromptCost ?? null,
    upstream_completion_cost_usd: usage?.upstreamInferenceCompletionsCost ?? null,
  };
}

function extractErrorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null) {
    const data = (error as { data?: unknown }).data;
    if (typeof data === "object" && data !== null) {
      const code = (data as { code?: unknown }).code;
      if (typeof code === "string") {
        return code;
      }
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/"code"\s*:\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

export function openRouterFailureCategory(error: unknown): OpenRouterFailureCategory {
  const code = extractErrorCode(error)?.toLowerCase() ?? "";
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const combined = `${code} ${message}`;

  if (combined.includes("missing_api_key") || combined.includes("missing api key")) {
    return "missing_api_key";
  }
  if (
    combined.includes("invalid_api_key") ||
    combined.includes("invalid api key") ||
    combined.includes("unauthorized") ||
    combined.includes("401")
  ) {
    return "invalid_api_key";
  }
  if (
    combined.includes("insufficient_credits") ||
    combined.includes("insufficient credits") ||
    combined.includes("payment required") ||
    combined.includes("402") ||
    combined.includes("credit balance")
  ) {
    return "insufficient_credits";
  }
  if (
    combined.includes("model_unavailable") ||
    combined.includes("zdr_model_unavailable") ||
    combined.includes("google_data_model_unavailable") ||
    combined.includes("model isn't available") ||
    combined.includes("model is not available") ||
    combined.includes("no endpoints found") ||
    combined.includes("no endpoint")
  ) {
    return "model_unavailable";
  }
  if (
    combined.includes("rate_limit") ||
    combined.includes("rate limited") ||
    combined.includes("too many requests") ||
    combined.includes("429")
  ) {
    return "rate_limited";
  }
  if (
    combined.includes("context_length") ||
    combined.includes("context length") ||
    combined.includes("maximum context") ||
    combined.includes("tokens exceed") ||
    combined.includes("too many tokens")
  ) {
    return "context_length_exceeded";
  }
  if (
    combined.includes("aborterror") ||
    combined.includes("timeout") ||
    combined.includes("timed out") ||
    combined.includes("stream_timeout")
  ) {
    return "timeout";
  }
  if (
    combined.includes("provider") ||
    combined.includes("upstream") ||
    combined.includes("openrouter") ||
    combined.includes("502") ||
    combined.includes("503") ||
    combined.includes("504")
  ) {
    return "provider_error";
  }

  return "unknown_error";
}
