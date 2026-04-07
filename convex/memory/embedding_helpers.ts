import { MODEL_IDS } from "../lib/model_constants";
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

export async function computeEmbedding(
  text: string,
  apiKey: string,
): Promise<EmbeddingResult | null> {
  try {
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
        }),
      },
    );

    if (!response.ok) {
      console.error(`Embedding API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const embedding = data.data?.[0]?.embedding ?? null;
    if (!embedding) return null;

    // M23: Parse usage from OpenRouter embeddings response.
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
