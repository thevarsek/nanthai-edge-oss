import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { HTTP_REFERER, X_TITLE } from "../lib/openrouter_constants";
import {
  fetchImageEndpoints,
  prepareImageModel,
} from "./image_sync_contract";
import type {
  ImageCatalogModel,
  ImageEndpointFetchResult,
} from "./image_sync_contract";
import { removeImageOutputModality } from "./media_capabilities";

const IMAGE_MODELS_URL = "https://openrouter.ai/api/v1/images/models";
const ENDPOINT_CONCURRENCY = 4;
const BATCH_SIZE = 20;

export const syncImageModels = internalAction({
  args: {},
  handler: async (ctx) => {
    const response = await fetch(IMAGE_MODELS_URL, {
      headers: { "HTTP-Referer": HTTP_REFERER, "X-Title": X_TITLE },
    });
    if (!response.ok) {
      console.error(
        `Image models sync failed: ${response.status} ${response.statusText}`,
      );
      return;
    }

    const payload = await response.json() as { data?: ImageCatalogModel[] };
    const rawModels = Array.isArray(payload.data) ? payload.data : [];
    if (rawModels.length === 0) {
      console.warn("Image models sync returned no models; preserving catalog");
      return;
    }

    const endpointResponses = new Map<string, ImageEndpointFetchResult>();
    for (let index = 0; index < rawModels.length; index += ENDPOINT_CONCURRENCY) {
      const chunk = rawModels.slice(index, index + ENDPOINT_CONCURRENCY);
      const results = await Promise.all(chunk.map(async (model) => [
        model.id,
        await fetchImageEndpoints(model.id),
      ] as const));
      for (const [modelId, endpointResponse] of results) {
        endpointResponses.set(modelId, endpointResponse);
      }
    }

    let upserted = 0;
    let created = 0;
    let skipped = 0;
    let unavailable = 0;
    const activeModelIds = new Set<string>();
    const unavailableModelIds = new Set<string>();
    for (let index = 0; index < rawModels.length; index += BATCH_SIZE) {
      const models = rawModels.slice(index, index + BATCH_SIZE).flatMap((model) => {
        const endpointResult = endpointResponses.get(model.id);
        if (!endpointResult || endpointResult.status === "transient_failure") {
          activeModelIds.add(model.id);
          skipped += 1;
          return [];
        }
        if (endpointResult.status === "unavailable") {
          unavailableModelIds.add(model.id);
          unavailable += 1;
          return [];
        }
        activeModelIds.add(model.id);
        return [prepareImageModel(model, endpointResult.response)];
      });
      if (models.length === 0) continue;
      const result = await ctx.runMutation(
        internal.models.image_sync.upsertImageModelsBatch,
        { models },
      );
      upserted += result.upserted;
      created += result.created;
    }

    const discoveryComplete = rawModels.every((model) => model.id.trim().length > 0);
    let pruned = 0;
    let deactivated = 0;
    if (discoveryComplete) {
      const result = await ctx.runMutation(
        internal.models.image_sync.pruneStaleImageModels,
        {
          activeModelIds: Array.from(activeModelIds),
          unavailableModelIds: Array.from(unavailableModelIds),
        },
      );
      pruned = result.deleted;
      deactivated = result.deactivated ?? 0;
    } else {
      console.warn("Image model discovery was incomplete; preserving stale rows");
    }

    console.info("Image models synced from dedicated API", {
      modelCount: rawModels.length,
      upserted,
      created,
      skipped,
      unavailable,
      pruned,
      deactivated,
    });
  },
});

const capabilityDescriptor = v.object({
  type: v.optional(v.string()),
  values: v.optional(v.array(v.string())),
  min: v.optional(v.number()),
  max: v.optional(v.number()),
});

const preparedImageModel = v.object({
  modelId: v.string(),
  imageOnly: v.boolean(),
  name: v.string(),
  description: v.optional(v.string()),
  provider: v.string(),
  canonicalSlug: v.string(),
  supportedParameters: v.array(v.string()),
  architecture: v.object({ modality: v.string() }),
  imageCapabilities: v.object({
    isAvailable: v.literal(true),
    pricePerImage: v.optional(v.number()),
    pricePerMegapixel: v.optional(v.number()),
    pricingSkus: v.optional(v.object({
      imageToken: v.optional(v.string()),
      imageOutput: v.optional(v.string()),
    })),
    supportedParameters: v.record(v.string(), capabilityDescriptor),
    supportsStreaming: v.boolean(),
    maxInputReferences: v.optional(v.number()),
    allowedPassthroughParameters: v.array(v.string()),
    pricing: v.array(v.object({
      billable: v.string(),
      unit: v.string(),
      costUsd: v.number(),
      variant: v.optional(v.string()),
    })),
    endpoints: v.array(v.object({
      providerName: v.optional(v.string()),
      providerSlug: v.string(),
      providerTag: v.optional(v.union(v.string(), v.null())),
      supportedParameters: v.record(v.string(), capabilityDescriptor),
      allowedPassthroughParameters: v.array(v.string()),
      supportsStreaming: v.boolean(),
      pricing: v.array(v.object({
        billable: v.string(),
        unit: v.string(),
        costUsd: v.number(),
        variant: v.optional(v.string()),
      })),
    })),
  }),
});

export const upsertImageModelsBatch = internalMutation({
  args: { models: v.array(preparedImageModel) },
  returns: v.object({ upserted: v.number(), created: v.number() }),
  handler: async (ctx, { models }) => {
    let created = 0;
    const now = Date.now();

    for (const model of models) {
      const existing = await ctx.db
        .query("cachedModels")
        .withIndex("by_modelId", (query) => query.eq("modelId", model.modelId))
        .first();
      // Ownership is intrinsic to the dedicated catalog shape, not sync order.
      // Hybrid text+image models belong to the general catalog even when the
      // image sync happens to discover and insert them first.
      const managedByImageSync = model.imageOnly;
      const imageCapabilities = {
        ...model.imageCapabilities,
        managedByImageSync,
        syncedAt: now,
      };

      if (!existing) {
        await ctx.db.insert("cachedModels", {
          modelId: model.modelId,
          name: model.name,
          description: model.description,
          provider: model.provider,
          canonicalSlug: model.canonicalSlug,
          supportsImages: true,
          supportsVideo: false,
          supportsTools: false,
          supportedParameters: model.supportedParameters,
          architecture: model.architecture,
          imageCapabilities,
          lastSyncedAt: now,
        });
        created += 1;
        continue;
      }

      const sharedPatch = {
        supportsImages: true,
        architecture: {
          ...existing.architecture,
          modality: model.architecture.modality,
        },
        imageCapabilities,
        lastSyncedAt: now,
      };
      if (managedByImageSync || model.imageOnly) {
        await ctx.db.patch(existing._id, {
          ...sharedPatch,
          name: model.name,
          description: model.description,
          provider: model.provider,
          canonicalSlug: model.canonicalSlug,
          supportedParameters: model.supportedParameters,
          supportsTools: false,
        });
      } else {
        // Main catalog owns chat/text fields for multimodal models. Image sync
        // only owns output capability, pricing, and the image API descriptor.
        await ctx.db.patch(existing._id, sharedPatch);
      }
    }

    return { upserted: models.length, created };
  },
});

export const pruneStaleImageModels = internalMutation({
  args: {
    activeModelIds: v.array(v.string()),
    unavailableModelIds: v.array(v.string()),
  },
  returns: v.object({ deleted: v.number(), deactivated: v.number() }),
  handler: async (ctx, { activeModelIds, unavailableModelIds }) => {
    const activeSet = new Set(activeModelIds);
    const unavailableSet = new Set(unavailableModelIds);
    const models = await ctx.db.query("cachedModels").collect();
    let deleted = 0;
    let deactivated = 0;
    const now = Date.now();

    for (const model of models) {
      if (activeSet.has(model.modelId)) continue;
      // Rows first discovered by the general model sync do not yet have an
      // imageCapabilities object. An authoritative zero-endpoint response must
      // still deactivate them; otherwise models such as openrouter/auto remain
      // selectable and fail every request at the dedicated Images endpoint.
      if (!model.imageCapabilities && !unavailableSet.has(model.modelId)) continue;

      const outputModalities = model.architecture?.modality
        ?.split("->")[1]
        ?.split("+") ?? [];
      const hasNonImageOutput = outputModalities.some(
        (modality) => modality !== "image",
      );
      if (
        model.imageCapabilities?.managedByImageSync === true ||
        (outputModalities.includes("image") && !hasNonImageOutput)
      ) {
        await ctx.db.delete(model._id);
        deleted += 1;
        continue;
      }

      await ctx.db.patch(model._id, {
        supportsImages: false,
        architecture: model.architecture
          ? {
              ...model.architecture,
              modality: removeImageOutputModality(model.architecture.modality),
            }
          : undefined,
        imageCapabilities: {
          isAvailable: false,
          supportedParameters: {},
          supportsStreaming: false,
          allowedPassthroughParameters: [],
          pricing: [],
          endpoints: [],
          managedByImageSync: false,
          syncedAt: now,
        },
      });
      deactivated += 1;
    }

    return { deleted, deactivated };
  },
});
