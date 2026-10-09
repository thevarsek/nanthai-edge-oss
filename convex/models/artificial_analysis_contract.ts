export type BenchmarkSyncArgs = {
  unavailableCategories?: Array<"language" | "image">;
  llmModels: Array<{
    externalId: string;
    slug: string;
    aaName?: string;
    creatorSlug?: string;
    creatorName?: string;
    intelligenceIndex?: number;
    codingIndex?: number;
    mathIndex?: number;
    agenticIndex?: number;
    speedTokensPerSecond?: number;
    timeToFirstTokenSeconds?: number;
    aaInputPricePer1M?: number;
    aaOutputPricePer1M?: number;
    aaBlendedPricePer1M?: number;
  }>;
  imageModels: Array<{
    externalId: string;
    slug: string;
    elo?: number;
    rank?: number;
    releaseDate?: string;
  }>;
};
