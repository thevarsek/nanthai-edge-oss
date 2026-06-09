import { ConvexError } from "convex/values";
import { MODEL_IDS, OPENROUTER_DEFAULT_PROVIDER_SORT } from "../lib/model_constants";
import { HTTP_REFERER, X_TITLE } from "../lib/openrouter_constants";

/** M23: Embedding result including optional usage for cost tracking. */
export interface EmbeddingResult {
  embedding: number[];
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
  generationId?: string;
}

function buildEmbeddingProvider(requireZdr: boolean): Record<string, unknown> | undefined {
  const provider: Record<string, unknown> = {
    ...(OPENROUTER_DEFAULT_PROVIDER_SORT ?? {}),
  };
  if (requireZdr) provider.zdr = true;
  return Object.keys(provider).length > 0 ? provider : undefined;
}

/**
 * Compute embedding via OpenRouter using the caller's BYOK API key.
 * All embedding cost and quota is attributed to the user's OpenRouter account.
 *
 * OpenRouter currently accepts `provider.zdr` on `/embeddings` for
 * openai/text-embedding-3-small. Verified with a direct probe on 2026-06-08.
 * If that route regresses, ZDR callers fail closed with a stable error code
 * instead of retrying without the privacy constraint.
 */
export async function computeEmbedding(
  text: string,
  apiKey: string,
  options: { requireZdr?: boolean } = {},
): Promise<EmbeddingResult | null> {
  try {
    const provider = buildEmbeddingProvider(options.requireZdr === true);
    const response = await fetch(
      "https://openrouter.ai/api/v1/embeddings",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": HTTP_REFERER,
          "X-Title": X_TITLE,
        },
        body: JSON.stringify({
          model: MODEL_IDS.embedding,
          input: text.substring(0, 8000),
          ...(provider ? { provider } : {}),
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

    const rawUsage = data.usage;
    const usage = rawUsage
      ? {
          promptTokens: rawUsage.prompt_tokens ?? 0,
          totalTokens: rawUsage.total_tokens ?? rawUsage.prompt_tokens ?? 0,
        }
      : undefined;

    return {
      embedding,
      usage,
      generationId: data.id ?? undefined,
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
