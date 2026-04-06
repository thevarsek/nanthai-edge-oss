// convex/chat/actions_fetch_usage.ts
// =============================================================================
// Fetches authoritative token-usage data from the OpenRouter Generations API
// after a generation completes, then persists it to `messages` and
// `usageRecords`.
//
// The OpenRouter SSE stream does not reliably emit usage on all providers.
// The Generations endpoint (`GET /api/v1/generation?id=`) is the canonical
// source and is available ~2 s after the stream ends.
//
// Retry strategy: up to 3 attempts with exponential backoff (2s, 4s, 8s).
// The Generations API may return 404 or empty tokens if queried too soon
// after the stream finishes.
// =============================================================================

import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { HTTP_REFERER, X_TITLE } from "../lib/openrouter_constants";
import { getOptionalUserOpenRouterApiKey } from "../lib/user_secrets";

const OPENROUTER_GENERATIONS_URL = "https://openrouter.ai/api/v1/generation";

/** Max retry attempts for transient failures (404 / empty tokens). */
const MAX_RETRIES = 3;
/** Backoff delays in ms for each retry attempt. */
const BACKOFF_DELAYS = [2000, 4000, 8000];

/**
 * Full response shape from the OpenRouter Generations API.
 * See: https://openrouter.ai/docs/api/api-reference/generations/get-generation
 */
interface GenerationData {
  id: string;
  tokens_prompt?: number | null;
  tokens_completion?: number | null;
  total_cost?: number | null;
  is_byok?: boolean;
  upstream_inference_cost?: number | null;
  cache_discount?: number | null;
  // Native token breakdowns (provider-reported)
  native_tokens_prompt?: number | null;
  native_tokens_completion?: number | null;
  native_tokens_reasoning?: number | null;
  native_tokens_cached?: number | null;
  native_tokens_completion_images?: number | null;
  // Media counts
  num_media_prompt?: number | null;
  num_input_audio_prompt?: number | null;
  num_media_completion?: number | null;
}

interface GenerationsResponse {
  data?: GenerationData;
}

/**
 * Fetch generation data with retry-on-404/empty-tokens.
 * Returns null only after all retries are exhausted.
 */
async function fetchGenerationData(
  apiKey: string,
  generationId: string,
): Promise<GenerationData | null> {
  const url = `${OPENROUTER_GENERATIONS_URL}?id=${encodeURIComponent(generationId)}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BACKOFF_DELAYS[attempt - 1] ?? 8000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": HTTP_REFERER,
          "X-Title": X_TITLE,
        },
      });
    } catch {
      // Network error — retry
      continue;
    }

    if (response.status === 404) {
      // Generation not indexed yet — retry after backoff
      continue;
    }

    if (!response.ok) {
      // Non-retryable HTTP error — bail
      return null;
    }

    let parsed: GenerationsResponse;
    try {
      parsed = (await response.json()) as GenerationsResponse;
    } catch {
      return null;
    }

    const data = parsed.data ?? null;
    if (!data) return null;

    // If tokens are still zero, the record may not be ready — retry
    const prompt = data.tokens_prompt ?? 0;
    const completion = data.tokens_completion ?? 0;
    if (prompt === 0 && completion === 0 && attempt < MAX_RETRIES) {
      continue;
    }

    return data;
  }

  return null;
}

export interface FetchAndStoreGenerationUsageArgs
  extends Record<string, unknown> {
  messageId: Id<"messages">;
  chatId: Id<"chats">;
  userId: string;
  openrouterGenerationId: string;
}

export async function fetchAndStoreGenerationUsageHandler(
  ctx: ActionCtx,
  args: FetchAndStoreGenerationUsageArgs,
): Promise<void> {
  const apiKey = await getOptionalUserOpenRouterApiKey(ctx, args.userId);
  if (!apiKey) return;

  const data = await fetchGenerationData(apiKey, args.openrouterGenerationId);
  if (!data) return;

  const promptTokens = data.tokens_prompt ?? 0;
  const completionTokens = data.tokens_completion ?? 0;
  const totalTokens = promptTokens + completionTokens;

  // Skip if there are no tokens at all — the record isn't ready yet.
  if (promptTokens === 0 && completionTokens === 0) return;

  const cost =
    typeof data.total_cost === "number" ? data.total_cost : undefined;

  // Extract enriched fields from the Generations API response.
  // Map native_tokens_* fields to our canonical field names.
  const isByok = data.is_byok === true ? true : undefined;
  const cachedTokens = numOrUndef(data.native_tokens_cached);
  const reasoningTokens = numOrUndef(data.native_tokens_reasoning);
  const imageCompletionTokens = numOrUndef(
    data.native_tokens_completion_images,
  );
  const upstreamInferenceCost = numOrUndef(data.upstream_inference_cost);

  await ctx.runMutation(internal.chat.mutations.storeGenerationUsage, {
    messageId: args.messageId,
    chatId: args.chatId,
    userId: args.userId,
    promptTokens,
    completionTokens,
    totalTokens,
    cost,
    isByok,
    cachedTokens,
    reasoningTokens,
    imageCompletionTokens,
    upstreamInferenceCost,
  });
}

/** Convert a nullable number to number | undefined (strip null). */
function numOrUndef(v: number | null | undefined): number | undefined {
  return typeof v === "number" ? v : undefined;
}
