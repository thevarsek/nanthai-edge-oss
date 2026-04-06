// convex/models/queries.ts
// =============================================================================
// Public model queries. Extended with optional guidance data.
//
// These re-export the same public function names that sync.ts used to export,
// so client-facing function strings in AppConstants remain unchanged.
// =============================================================================

import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";
import {
  filterExcludedOpenRouterProviders,
  isExcludedOpenRouterProvider,
} from "./provider_filters";

/** Minimum context length (tokens) a model must have to appear in the app. */
const MIN_CONTEXT_LENGTH = 100_000;

/** Google models have a lower threshold — many capable models are 32K–65K. */
const MIN_CONTEXT_LENGTH_GOOGLE = 32_000;

function meetsMinContext(
  contextLength: number | undefined,
  provider: string | undefined,
): boolean {
  const min =
    provider === "google" ? MIN_CONTEXT_LENGTH_GOOGLE : MIN_CONTEXT_LENGTH;
  return (contextLength ?? 0) >= min;
}

/**
 * Safety cap for unfiltered model catalog queries. The OpenRouter catalog
 * currently has ~300 models but is growing; this prevents unbounded reads
 * if the catalog balloons unexpectedly.
 */
const MODEL_CATALOG_SAFETY_CAP = 2000;

/** List all cached models with guidance data (reactive). */
export const listModels = query({
  args: {
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const raw = args.provider
      ? await ctx.db
          .query("cachedModels")
          .withIndex("by_provider", (q) => q.eq("provider", args.provider!))
          .collect()
      : await ctx.db.query("cachedModels").take(MODEL_CATALOG_SAFETY_CAP);
    return filterExcludedOpenRouterProviders(raw).filter((m) =>
      meetsMinContext(m.contextLength, m.provider)
    );
  },
});

/** Get a single model's full data including guidance. */
export const getModel = query({
  args: { modelId: v.string() },
  handler: async (ctx, args) => {
    const model = await ctx.db
      .query("cachedModels")
      .withIndex("by_modelId", (q) => q.eq("modelId", args.modelId))
      .first();
    if (isExcludedOpenRouterProvider(model?.provider)) return null;
    return model;
  },
});

/** Lightweight model summaries for picker/list screens, with guidance scores. */
export const listModelSummaries = query({
  args: {
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const raw = args.provider
      ? await ctx.db
          .query("cachedModels")
          .withIndex("by_provider", (q) => q.eq("provider", args.provider!))
          .collect()
      : await ctx.db.query("cachedModels").take(MODEL_CATALOG_SAFETY_CAP);

    return filterExcludedOpenRouterProviders(raw)
      .filter((m) => meetsMinContext(m.contextLength, m.provider))
      .map((m) => ({
        _id: m._id,
        modelId: m.modelId,
        name: m.name,
        provider: m.provider,
        supportsImages: m.supportsImages,
        supportsTools: m.supportsTools,
        contextLength: m.contextLength,
        hasReasoning: (m.supportedParameters ?? []).includes("reasoning"),
        inputPricePer1M: m.inputPricePer1M,
        outputPricePer1M: m.outputPricePer1M,
        // Capability derivation data — allows clients to compute
        // hasVision, hasFileInput, hasAudioInput, etc. without a
        // full listModels subscription.
        architecture: m.architecture,
        supportedParameters: m.supportedParameters,
        // Guidance data (optional)
        derivedGuidance: m.derivedGuidance
          ? {
              labels: m.derivedGuidance.labels,
              primaryLabel: m.derivedGuidance.primaryLabel,
              supportedIntents: m.derivedGuidance.supportedIntents,
              scores: m.derivedGuidance.scores,
              ranks: m.derivedGuidance.ranks,
              totalRanked: m.derivedGuidance.totalRanked,
            }
          : undefined,
        openRouterUseCases: m.openRouterUseCases,
      }));
  },
});

/** Internal raw model list for backend sync jobs. */
export const listModelsInternalForSync = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("cachedModels").collect();
  },
});
