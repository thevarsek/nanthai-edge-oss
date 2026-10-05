import { ConvexError } from "convex/values";
import { MODEL_IDS, OPENROUTER_DEFAULT_PROVIDER_SORT } from "../lib/model_constants";
import { HTTP_REFERER, X_TITLE } from "../lib/openrouter_constants";
import type { ActionCtx } from "../_generated/server";
import { getOptionalUserOpenRouterApiKey } from "../lib/user_secrets";

export interface EmbeddingUsage {
  promptTokens: number;
  totalTokens: number;
  billingOwner?: "platform";
}

/** M23: Embedding result including optional usage for cost tracking. */
export interface EmbeddingResult {
  embedding: number[];
  usage?: EmbeddingUsage;
  generationId?: string;
  provider?: "openai";
}

export async function computeUserEmbedding(
  ctx: Pick<ActionCtx, "runQuery">,
  userId: string,
  text: string,
  options: { requireZdr?: boolean } = {},
): Promise<EmbeddingResult | null> {
  const apiKey = await getOptionalUserOpenRouterApiKey(ctx, userId);
  if (!apiKey?.trim() && !process.env.OPENAI_API_KEY?.trim()) {
    throw new ConvexError({ code: "MISSING_API_KEY", message: "No memory embedding connection is configured." });
  }
  return computeEmbedding(text, apiKey, options);
}

function buildEmbeddingProvider(requireZdr: boolean): Record<string, unknown> | undefined {
  const provider: Record<string, unknown> = {
    ...(OPENROUTER_DEFAULT_PROVIDER_SORT ?? {}),
  };
  if (requireZdr) provider.zdr = true;
  return Object.keys(provider).length > 0 ? provider : undefined;
}

/**
 * Use caller BYOK when connected; otherwise use the platform's OpenAI key.
 * Both routes share the existing 1536-dimensional memory embedding space.
 *
 * OpenRouter currently accepts `provider.zdr` on `/embeddings` for
 * openai/text-embedding-3-small. Verified with a direct probe on 2026-06-08.
 * If that route regresses, ZDR callers fail closed with a stable error code
 * instead of retrying without the privacy constraint.
 */
export async function computeEmbedding(
  text: string,
  apiKey: string | null,
  options: { requireZdr?: boolean } = {},
): Promise<EmbeddingResult | null> {
  try {
    const direct = !apiKey?.trim();
    const resolvedKey = direct ? process.env.OPENAI_API_KEY?.trim() : apiKey;
    if (!resolvedKey) return null;
    // Keep the user's existing retention requirement. A configured key alone
    // does not prove that its OpenAI project has approved ZDR controls.
    if (direct && options.requireZdr && process.env.OPENAI_EMBEDDING_ZDR_ENABLED !== "true") {
      throw new ConvexError({
        code: "ZDR_EMBEDDING_UNAVAILABLE" as const,
        message: "The platform embedding project has not been qualified for Zero Data Retention.",
      });
    }
    const provider = buildEmbeddingProvider(options.requireZdr === true);
    const response = await fetch(
      direct ? "https://api.openai.com/v1/embeddings" : "https://openrouter.ai/api/v1/embeddings",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resolvedKey}`,
          "Content-Type": "application/json",
          ...(!direct ? { "HTTP-Referer": HTTP_REFERER, "X-Title": X_TITLE } : {}),
        },
        body: JSON.stringify({
          model: direct ? MODEL_IDS.embedding.replace(/^openai\//, "") : MODEL_IDS.embedding,
          input: text.substring(0, 8000),
          ...(direct ? { dimensions: 1536 } : provider ? { provider } : {}),
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Embedding API error: ${response.status}`);
      if (options.requireZdr === true) {
        throw new ConvexError({
          code: "ZDR_EMBEDDING_UNAVAILABLE" as const,
          message:
            "Memory embeddings are unavailable with Zero Data Retention for " +
            `${MODEL_IDS.embedding}. Contextual memory retrieval was skipped.`,
          details: errorText.slice(0, 300),
        });
      }
      return null;
    }

    const data = await response.json();
    const embedding = data.data?.[0]?.embedding ?? null;
    if (!embedding) return null;
    if (direct && (!Array.isArray(embedding) || embedding.length !== 1536
      || !embedding.every((value: unknown) => typeof value === "number" && Number.isFinite(value)))) return null;

    const rawUsage = data.usage;
    const usage = rawUsage
      ? {
          promptTokens: rawUsage.prompt_tokens ?? 0,
          totalTokens: rawUsage.total_tokens ?? rawUsage.prompt_tokens ?? 0,
          ...(direct ? { billingOwner: "platform" as const } : {}),
        }
      : undefined;

    if (direct) console.info("[memory] platform embedding usage", {
      provider: "openai", model: MODEL_IDS.embedding, billingOwner: "platform",
      promptTokens: usage?.promptTokens ?? null,
    });

    return {
      embedding,
      usage,
      generationId: data.id ?? undefined,
      ...(direct ? { provider: "openai" as const } : {}),
    };
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    console.error("Embedding computation failed:", error);
    return null;
  }
}

export function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter((word) => wordsB.has(word)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}
