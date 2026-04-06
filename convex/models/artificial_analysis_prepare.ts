import { v } from "convex/values";
import {
  matchModel,
  buildAaIndex,
  type AaLlmEntry,
  type AaImageEntry,
  type OrModelInput,
} from "./guidance_matching";
import {
  buildNormalizationPool,
  normalizeMetrics,
  computeScores,
  type BenchmarkInputLlm,
  type BenchmarkInputImage,
  type ModelPricingInput,
  type ModelContextInput,
  type DerivedScores,
} from "./guidance_scoring";
import {
  computeAllRanks,
  deriveLabels,
  deriveSupportedIntents,
} from "./guidance_scoring_labels";
import { deepEqual } from "./sync_diff";

export const benchmarkSyncArgs = {
  llmModels: v.array(
    v.object({
      externalId: v.string(),
      slug: v.string(),
      aaName: v.optional(v.string()),
      creatorSlug: v.optional(v.string()),
      creatorName: v.optional(v.string()),
      intelligenceIndex: v.optional(v.number()),
      codingIndex: v.optional(v.number()),
      mathIndex: v.optional(v.number()),
      agenticIndex: v.optional(v.number()),
      speedTokensPerSecond: v.optional(v.number()),
      timeToFirstTokenSeconds: v.optional(v.number()),
      aaInputPricePer1M: v.optional(v.number()),
      aaOutputPricePer1M: v.optional(v.number()),
      aaBlendedPricePer1M: v.optional(v.number()),
    }),
  ),
  imageModels: v.array(
    v.object({
      externalId: v.string(),
      slug: v.string(),
      elo: v.optional(v.number()),
      rank: v.optional(v.number()),
      releaseDate: v.optional(v.string()),
    }),
  ),
};

export type BenchmarkSyncArgs = {
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

export type BenchmarkPatch = {
  docId: string;
  patch: Record<string, unknown>;
};

type CachedModelDoc = Record<string, unknown> & {
  _id: string;
  modelId: string;
  name: string;
  provider?: string;
  canonicalSlug?: string;
  contextLength?: number;
  inputPricePer1M?: number;
  outputPricePer1M?: number;
};

export function prepareBenchmarkUpdates(
  allModels: CachedModelDoc[],
  args: BenchmarkSyncArgs,
  now: number,
): {
  matchedCount: number;
  totalModels: number;
  patches: BenchmarkPatch[];
} {
  const MIN_CONTEXT = 100_000;
  const MIN_CONTEXT_GOOGLE = 32_000;

  function meetsMinContext(ctxLen?: number, provider?: string): boolean {
    const min = provider === "google" ? MIN_CONTEXT_GOOGLE : MIN_CONTEXT;
    return (ctxLen ?? 0) >= min;
  }

  const aaLlmEntries: AaLlmEntry[] = args.llmModels.map((m) => ({
    slug: m.slug,
    name: m.aaName,
    creatorSlug: m.creatorSlug,
  }));
  const aaImageEntries: AaImageEntry[] = args.imageModels.map((m) => ({
    slug: m.slug,
  }));
  const llmBySlug = new Map(args.llmModels.map((m) => [m.slug, m]));
  const imageBySlug = new Map(args.imageModels.map((m) => [m.slug, m]));
  const aaLlmIndex = buildAaIndex(aaLlmEntries);

  type MatchResult = {
    modelId: string;
    docId: string;
    provider: string | undefined;
    match: ReturnType<typeof matchModel>;
    llmData: BenchmarkSyncArgs["llmModels"][number] | undefined;
    imageData: BenchmarkSyncArgs["imageModels"][number] | undefined;
    orPrice: number | undefined;
    contextLength: number | undefined;
  };

  const matchResults: MatchResult[] = [];
  for (const model of allModels) {
    const orInput: OrModelInput = {
      id: model.modelId,
      name: model.name,
      canonicalSlug: (model.canonicalSlug as string | undefined) ?? undefined,
    };
    const match = matchModel(orInput, aaLlmEntries, aaImageEntries, aaLlmIndex);
    const llmData = match?.aaLlmSlug ? llmBySlug.get(match.aaLlmSlug) : undefined;
    const imageData = match?.aaImageSlug ? imageBySlug.get(match.aaImageSlug) : undefined;
    const orPrice =
      model.inputPricePer1M !== undefined && model.outputPricePer1M !== undefined
        ? model.inputPricePer1M + model.outputPricePer1M
        : undefined;

    matchResults.push({
      modelId: model.modelId,
      docId: model._id,
      provider: model.provider,
      match,
      llmData,
      imageData,
      orPrice,
      contextLength: model.contextLength,
    });
  }

  const poolLlms: BenchmarkInputLlm[] = [];
  const poolImages: BenchmarkInputImage[] = [];
  const poolPrices: (number | undefined)[] = [];
  const poolContexts: (number | undefined)[] = [];

  for (const r of matchResults) {
    if (r.llmData) {
      poolLlms.push({
        intelligenceIndex: r.llmData.intelligenceIndex,
        codingIndex: r.llmData.codingIndex,
        mathIndex: r.llmData.mathIndex,
        agenticIndex: r.llmData.agenticIndex,
        speedTokensPerSecond: r.llmData.speedTokensPerSecond,
        timeToFirstTokenSeconds: r.llmData.timeToFirstTokenSeconds,
        aaBlendedPricePer1M: r.llmData.aaBlendedPricePer1M,
      });
      poolPrices.push(r.orPrice ?? r.llmData.aaBlendedPricePer1M);
      poolContexts.push(r.contextLength);
    }
    if (r.imageData) {
      poolImages.push({ elo: r.imageData.elo, rank: r.imageData.rank });
    }
  }

  const pool = buildNormalizationPool(poolLlms, poolImages, poolPrices, poolContexts);

  type ScoredResult = MatchResult & { scores: DerivedScores };
  const scoredResults: ScoredResult[] = [];
  for (const r of matchResults) {
    if (!r.match) continue;
    const llmInput: BenchmarkInputLlm | undefined = r.llmData
      ? {
          intelligenceIndex: r.llmData.intelligenceIndex,
          codingIndex: r.llmData.codingIndex,
          mathIndex: r.llmData.mathIndex,
          agenticIndex: r.llmData.agenticIndex,
          speedTokensPerSecond: r.llmData.speedTokensPerSecond,
          timeToFirstTokenSeconds: r.llmData.timeToFirstTokenSeconds,
          aaBlendedPricePer1M: r.llmData.aaBlendedPricePer1M,
        }
      : undefined;
    const imageInput: BenchmarkInputImage | undefined = r.imageData
      ? { elo: r.imageData.elo, rank: r.imageData.rank }
      : undefined;
    const pricing: ModelPricingInput = {
      orTotalPricePer1M: r.orPrice,
      aaBlendedPricePer1M: r.llmData?.aaBlendedPricePer1M,
    };
    const context: ModelContextInput = { contextLength: r.contextLength };
    const normalized = normalizeMetrics(llmInput, imageInput, pricing, context, pool);
    const scores = computeScores(normalized, llmInput !== undefined, imageInput !== undefined);
    scoredResults.push({ ...r, scores });
  }

  const visibleScored = scoredResults.filter((r) => meetsMinContext(r.contextLength, r.provider));
  const ranksInput = visibleScored.map((r) => ({ id: r.docId, scores: r.scores }));
  const ranksMap = computeAllRanks(ranksInput);
  const totalRanked = visibleScored.length;

  const patches: BenchmarkPatch[] = [];
  let matchedCount = 0;
  for (const r of scoredResults) {
    matchedCount++;
    const ranks = ranksMap.get(r.docId);
    const { labels, primaryLabel } = deriveLabels(r.scores, ranks);
    const supportedIntents = deriveSupportedIntents(r.scores);

    const benchmarkLlm = r.llmData
      ? {
          source: "artificial_analysis" as const,
          externalId: r.llmData.externalId,
          slug: r.llmData.slug,
          creatorSlug: r.llmData.creatorSlug,
          creatorName: r.llmData.creatorName,
          intelligenceIndex: r.llmData.intelligenceIndex,
          codingIndex: r.llmData.codingIndex,
          mathIndex: r.llmData.mathIndex,
          agenticIndex: r.llmData.agenticIndex,
          speedTokensPerSecond: r.llmData.speedTokensPerSecond,
          timeToFirstTokenSeconds: r.llmData.timeToFirstTokenSeconds,
          aaInputPricePer1M: r.llmData.aaInputPricePer1M,
          aaOutputPricePer1M: r.llmData.aaOutputPricePer1M,
          aaBlendedPricePer1M: r.llmData.aaBlendedPricePer1M,
          syncedAt: now,
        }
      : undefined;

    const benchmarkMedia = r.imageData
      ? {
          textToImage: {
            source: "artificial_analysis" as const,
            externalId: r.imageData.externalId,
            slug: r.imageData.slug,
            elo: r.imageData.elo,
            rank: r.imageData.rank,
            releaseDate: r.imageData.releaseDate,
            syncedAt: now,
          },
        }
      : undefined;

    const patch: Record<string, unknown> = {
      guidanceMatch: {
        source: r.match!.source,
        strategy: r.match!.strategy,
        confidence: r.match!.confidence,
      },
      derivedGuidance: {
        labels,
        primaryLabel,
        supportedIntents,
        scores: r.scores,
        ranks: ranks ?? {},
        totalRanked,
        lastDerivedAt: now,
      },
    };
    if (benchmarkLlm) patch.benchmarkLlm = benchmarkLlm;
    if (benchmarkMedia) patch.benchmarkMedia = benchmarkMedia;

    const existingModel = allModels.find((model) => model._id === r.docId);
    if (existingModel && benchmarkPatchEqual(existingModel, patch)) {
      continue;
    }

    patches.push({ docId: r.docId, patch });
  }

  return {
    matchedCount,
    totalModels: allModels.length,
    patches,
  };
}

export function benchmarkPatchEqual(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): boolean {
  const relevantExisting = {
    guidanceMatch: existing.guidanceMatch,
    derivedGuidance: existing.derivedGuidance,
    benchmarkLlm: existing.benchmarkLlm,
    benchmarkMedia: existing.benchmarkMedia,
  };
  return deepEqual(
    normalizeBenchmarkValue(relevantExisting),
    normalizeBenchmarkValue(patch),
  );
}

function normalizeBenchmarkValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeBenchmarkValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "lastDerivedAt" || key === "syncedAt") {
      continue;
    }
    const normalizedChild = normalizeBenchmarkValue(child);
    if (normalizedChild !== undefined) {
      normalized[key] = normalizedChild;
    }
  }
  return normalized;
}
