// convex/models/video_sync.ts
// =============================================================================
// Sync video-specific model capabilities from OpenRouter's dedicated
// /api/v1/videos/models endpoint.
//
// Video generation models (Sora, Seedance, Veo, etc.) do NOT appear in the
// general /api/v1/models endpoint at all. They are exclusively listed here.
// This means we must CREATE cachedModels rows for them (not just patch), and
// also set supportsVideo + videoCapabilities.
//
// Cadence: every 4 hours via cron (offset from the main model sync).
// =============================================================================

import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { HTTP_REFERER, X_TITLE } from "../lib/openrouter_constants";

// -- Types for the video models API response ----------------------------------

interface VideoModelResponse {
  id: string;
  name?: string;
  canonical_slug?: string;
  description?: string;
  supported_resolutions?: string[];
  supported_aspect_ratios?: string[];
  supported_durations?: number[];
  supported_frame_images?: string[] | null;
  supported_sizes?: string[];
  generate_audio?: boolean;
  seed?: boolean;
  pricing_skus?: Record<string, string>;
  allowed_passthrough_parameters?: string[];
}

function extractProvider(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.substring(0, slash) : "unknown";
}

// -- Sync action --------------------------------------------------------------

export const syncVideoModels = internalAction({
  args: {},
  handler: async (ctx) => {
    const response = await fetch("https://openrouter.ai/api/v1/videos/models", {
      headers: {
        "HTTP-Referer": HTTP_REFERER,
        "X-Title": X_TITLE,
      },
    });

    if (!response.ok) {
      console.error(
        `Video models sync failed: ${response.status} ${response.statusText}`,
      );
      return;
    }

    const data = await response.json();
    const rawModels: VideoModelResponse[] = Array.isArray(data.data)
      ? data.data
      : Array.isArray(data)
        ? data
        : [];

    if (rawModels.length === 0) {
      console.log("Video models sync: no models returned — skipping");
      return;
    }

    // Process in batches to avoid mutation size limits
    const BATCH_SIZE = 20;
    let patchedCount = 0;
    let createdCount = 0;

    for (let i = 0; i < rawModels.length; i += BATCH_SIZE) {
      const batch = rawModels.slice(i, i + BATCH_SIZE);
      const result = await ctx.runMutation(
        internal.models.video_sync.upsertVideoModelsBatch,
        {
          models: batch.map((m) => ({
            modelId: m.id,
            name: m.name ?? m.id,
            canonicalSlug: m.canonical_slug,
            description: m.description,
            provider: extractProvider(m.id),
            videoCapabilities: {
              supportedResolutions: m.supported_resolutions ?? [],
              supportedAspectRatios: m.supported_aspect_ratios ?? [],
              supportedDurations: m.supported_durations ?? [],
              supportedFrameImages: m.supported_frame_images ?? [],
              supportedSizes: m.supported_sizes ?? [],
              generateAudio: m.generate_audio ?? false,
              seed: m.seed ?? false,
              pricingSkus: m.pricing_skus
                ? {
                    videoTokens: m.pricing_skus.video_tokens,
                    videoTokensWithoutAudio: m.pricing_skus.video_tokens_without_audio,
                    perVideoSecond: m.pricing_skus.per_video_second ?? m.pricing_skus.duration_seconds,
                    perVideoSecond1080p: m.pricing_skus.per_video_second_1080p ?? m.pricing_skus.duration_seconds_without_audio,
                  }
                : undefined,
              allowedPassthroughParameters: m.allowed_passthrough_parameters,
              syncedAt: Date.now(),
            },
          })),
        },
      );
      patchedCount += result.patched;
      createdCount += result.created;
    }

    console.log(
      `Video models synced: ${rawModels.length} from API, ${createdCount} created, ${patchedCount} patched`,
    );
  },
});

// -- Batch mutation -----------------------------------------------------------

const videoCapabilitiesValidator = v.object({
  supportedResolutions: v.array(v.string()),
  supportedAspectRatios: v.array(v.string()),
  supportedDurations: v.array(v.number()),
  supportedFrameImages: v.array(v.string()),
  supportedSizes: v.array(v.string()),
  generateAudio: v.boolean(),
  seed: v.boolean(),
  pricingSkus: v.optional(
    v.object({
      videoTokens: v.optional(v.string()),
      videoTokensWithoutAudio: v.optional(v.string()),
      perVideoSecond: v.optional(v.string()),
      perVideoSecond1080p: v.optional(v.string()),
    }),
  ),
  allowedPassthroughParameters: v.optional(v.array(v.string())),
  syncedAt: v.number(),
});

export const upsertVideoModelsBatch = internalMutation({
  args: {
    models: v.array(
      v.object({
        modelId: v.string(),
        name: v.string(),
        canonicalSlug: v.optional(v.string()),
        description: v.optional(v.string()),
        provider: v.string(),
        videoCapabilities: videoCapabilitiesValidator,
      }),
    ),
  },
  returns: v.object({ patched: v.number(), created: v.number() }),
  handler: async (ctx, args): Promise<{ patched: number; created: number }> => {
    let patched = 0;
    let created = 0;
    const now = Date.now();

    for (const model of args.models) {
      const existing = await ctx.db
        .query("cachedModels")
        .withIndex("by_modelId", (q) => q.eq("modelId", model.modelId))
        .first();

      if (existing) {
        // Patch existing row with video capabilities and correct modality.
        const correctModality = (model.videoCapabilities?.supportedFrameImages?.length ?? 0) > 0
          ? "text+image->video"
          : "text->video";
        await ctx.db.patch(existing._id, {
          supportsVideo: true,
          videoCapabilities: model.videoCapabilities,
          architecture: { ...existing.architecture, modality: correctModality },
        });
        patched++;
      } else {
        // Video-only model not in general /api/v1/models — create a minimal
        // cachedModels row so it appears in pickers. These models have no
        // context length or token pricing (they charge per video second/token).
        await ctx.db.insert("cachedModels", {
          modelId: model.modelId,
          name: model.name,
          canonicalSlug: model.canonicalSlug,
          description: model.description,
          provider: model.provider,
          // Video models don't have a context window — leave undefined
          contextLength: undefined,
          maxCompletionTokens: undefined,
          // Token pricing doesn't apply — video pricing is in videoCapabilities
          inputPricePer1M: undefined,
          outputPricePer1M: undefined,
          supportsImages: false,
          supportsVideo: true,
          supportsTools: false,
          supportedParameters: [],
          architecture: {
            // Use "+image" only when the model actually accepts frame images.
            // supportedFrameImages: [] means text-to-video only (e.g. Sora, Veo).
            modality: (model.videoCapabilities?.supportedFrameImages?.length ?? 0) > 0
              ? "text+image->video"
              : "text->video",
          },
          videoCapabilities: model.videoCapabilities,
          lastSyncedAt: now,
        });
        created++;
      }
    }

    return { patched, created };
  },
});
