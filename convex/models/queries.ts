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
  isEligibleModel,
} from "./model_filters";

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
    return filterExcludedOpenRouterProviders(raw).filter(isEligibleModel);
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
      .filter(isEligibleModel)
      .map((m) => ({
        _id: m._id,
        modelId: m.modelId,
        name: m.name,
        description: m.description,
        provider: m.provider,
        supportsImages: m.supportsImages,
        supportsVideo: m.supportsVideo,
        supportsTools: m.supportsTools,
        hasZdrEndpoint: m.hasZdrEndpoint ?? false,
        contextLength: m.contextLength,
        hasReasoning: (m.supportedParameters ?? []).includes("reasoning"),
        inputPricePer1M: m.inputPricePer1M,
        outputPricePer1M: m.outputPricePer1M,
        // A model is free only if its modelId uses the `:free` route suffix.
        // Zero pricing alone is NOT a reliable signal — some models (e.g.
        // audio/image generators) report $0 token prices but charge per request.
        isFree: m.modelId.endsWith(":free"),
        // Capability derivation data — allows clients to compute
        // hasVision, hasFileInput, hasAudioInput, etc. without a
        // full listModels subscription.
        architecture: m.architecture,
        supportedParameters: m.supportedParameters,
        // Video frame image support — which frame types this video model
        // accepts (e.g. ["first_frame", "last_frame"]). Empty array means
        // the model is text-to-video only and ignores attached images.
        // Only present for video models (supportsVideo: true).
        supportedFrameImages: m.supportsVideo
          ? (m.videoCapabilities?.supportedFrameImages ?? [])
          : undefined,
        // Video pricing — video models don't use token-based pricing;
        // they charge per video token or per video second.
        videoPricing: m.videoCapabilities?.pricingSkus
          ? {
              perVideoToken: m.videoCapabilities.pricingSkus.videoTokens
                ? parseFloat(m.videoCapabilities.pricingSkus.videoTokens)
                : undefined,
              perVideoTokenNoAudio: m.videoCapabilities.pricingSkus.videoTokensWithoutAudio
                ? parseFloat(m.videoCapabilities.pricingSkus.videoTokensWithoutAudio)
                : undefined,
              perVideoSecond: m.videoCapabilities.pricingSkus.perVideoSecond
                ? parseFloat(m.videoCapabilities.pricingSkus.perVideoSecond)
                : undefined,
              perVideoSecond1080p: m.videoCapabilities.pricingSkus.perVideoSecond1080p
                ? parseFloat(m.videoCapabilities.pricingSkus.perVideoSecond1080p)
                : undefined,
            }
          : undefined,
        // Raw OpenRouter pricing_skus map (keys vary by provider — e.g.
        // `duration_seconds_with_audio_4k`, `text_to_video_duration_seconds_1080p`).
        // Clients that need resolution/audio-aware pricing read this directly;
        // the narrow `videoPricing` summary above is a best-effort condensation.
        videoPricingSkus: m.videoCapabilities?.pricingSkusMap,
        // Image pricing hint — some multimodal providers (Gemini Image) bill
        // per image instead of (or in addition to) token-based completion
        // pricing. Undefined for image-only models unless populated via the
        // OpenRouter `/endpoints` pass below.
        pricePerImage: m.imageCapabilities?.pricePerImage,
        // Image SKU pricing from OpenRouter's /api/v1/models/{id}/endpoints.
        // These are the real per-image-token / per-image-output rates; the
        // listing endpoint reports $0 for image-only models.
        imagePricing: m.imageCapabilities?.pricingSkus
          ? {
              perImageToken: m.imageCapabilities.pricingSkus.imageToken
                ? parseFloat(m.imageCapabilities.pricingSkus.imageToken)
                : undefined,
              perImageOutput: m.imageCapabilities.pricingSkus.imageOutput
                ? parseFloat(m.imageCapabilities.pricingSkus.imageOutput)
                : undefined,
            }
          : undefined,
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
