// convex/models/sync.ts
// =============================================================================
// Model catalog sync: fetches OpenRouter /api/v1/models and upserts into
// cachedModels table. Called by cron every hour.
//
// This eliminates per-user model catalog fetches — all clients subscribe
// to queries.listModels() reactively.
// =============================================================================

import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { filterExcludedOpenRouterProviders } from "./provider_filters";
import { hasFieldsChanged, primitiveArraysEqual, deepEqual } from "./sync_diff";

// -- Model sync action --------------------------------------------------------

export const syncFromOpenRouter = internalAction({
  args: {},
  handler: async (ctx) => {
    // Fetch the OpenRouter model catalog
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        "HTTP-Referer": "https://nanthai.tech",
        "X-Title": "N:EDGE",
      },
    });

    if (!response.ok) {
      console.error(
        `Model catalog sync failed: ${response.status} ${response.statusText}`,
      );
      return;
    }

    const data = await response.json();
    const models = filterExcludedOpenRouterProviders(
      Array.isArray(data.data) ? data.data.map((model: Record<string, unknown>) => ({
        ...model,
        provider: extractProvider((model.id as string) ?? ""),
      })) : [],
    );

    if (models.length === 0) {
      console.error("Model catalog sync: no models returned");
      return;
    }

    // Process in batches to avoid mutation size limits
    const BATCH_SIZE = 50;
    for (let i = 0; i < models.length; i += BATCH_SIZE) {
      const batch = models.slice(i, i + BATCH_SIZE);
      await ctx.runMutation(internal.models.sync.upsertBatch, {
        models: batch.map((m: any) => ({
          modelId: m.id ?? "",
          name: m.name ?? m.id ?? "",
          canonicalSlug: m.canonical_slug ?? undefined,
          description: m.description ?? undefined,
          provider: m.provider ?? extractProvider(m.id ?? ""),
          contextLength: m.context_length ?? undefined,
          maxCompletionTokens: m.top_provider?.max_completion_tokens ?? undefined,
          inputPricePer1M: parsePricePer1M(m.pricing?.prompt),
          outputPricePer1M: parsePricePer1M(m.pricing?.completion),
          supportsImages: (() => {
            const modality = m.architecture?.modality ?? "";
            const parts = modality.split("->");
            return parts.length >= 2 && parts[1].includes("image");
          })(),
          supportsTools:
            (m.supported_parameters ?? []).includes("tools") ?? false,
          supportedParameters: m.supported_parameters ?? [],
          architecture: m.architecture
            ? {
                tokenizer: m.architecture.tokenizer ?? undefined,
                instructType: m.architecture.instruct_type ?? undefined,
                modality: m.architecture.modality ?? undefined,
              }
            : undefined,
        })),
      });
    }

    console.log(`Model catalog synced: ${models.length} models`);
  },
});

// -- Upsert batch mutation ----------------------------------------------------

export const upsertBatch = internalMutation({
  args: {
    models: v.array(
      v.object({
        modelId: v.string(),
        name: v.string(),
        canonicalSlug: v.optional(v.string()),
        description: v.optional(v.string()),
        provider: v.optional(v.string()),
        contextLength: v.optional(v.number()),
        maxCompletionTokens: v.optional(v.number()),
        inputPricePer1M: v.optional(v.number()),
        outputPricePer1M: v.optional(v.number()),
        supportsImages: v.optional(v.boolean()),
        supportsTools: v.optional(v.boolean()),
        supportedParameters: v.optional(v.array(v.string())),
        architecture: v.optional(
          v.object({
            tokenizer: v.optional(v.string()),
            instructType: v.optional(v.string()),
            modality: v.optional(v.string()),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    for (const model of args.models) {
      // Check if model already exists
      const existing = await ctx.db
        .query("cachedModels")
        .withIndex("by_modelId", (q) => q.eq("modelId", model.modelId))
        .first();

      if (existing) {
        // Diff before write: only patch if at least one synced field changed.
        // This avoids writing identical data every hour, which would
        // needlessly invalidate every listModels/listModelSummaries
        // subscription for all connected clients.
        const changed =
          hasFieldsChanged(existing as Record<string, unknown>, model, [
            "name",
            "canonicalSlug",
            "description",
            "provider",
            "contextLength",
            "maxCompletionTokens",
            "inputPricePer1M",
            "outputPricePer1M",
            "supportsImages",
            "supportsTools",
          ]) ||
          !primitiveArraysEqual(existing.supportedParameters, model.supportedParameters) ||
          !deepEqual(existing.architecture, model.architecture);

        if (changed) {
          await ctx.db.patch(existing._id, {
            name: model.name,
            canonicalSlug: model.canonicalSlug,
            description: model.description,
            provider: model.provider,
            contextLength: model.contextLength,
            maxCompletionTokens: model.maxCompletionTokens,
            inputPricePer1M: model.inputPricePer1M,
            outputPricePer1M: model.outputPricePer1M,
            supportsImages: model.supportsImages,
            supportsTools: model.supportsTools,
            supportedParameters: model.supportedParameters,
            architecture: model.architecture,
            lastSyncedAt: now,
          });
        }
      } else {
        // Insert new
        await ctx.db.insert("cachedModels", {
          modelId: model.modelId,
          name: model.name,
          canonicalSlug: model.canonicalSlug,
          description: model.description,
          provider: model.provider,
          contextLength: model.contextLength,
          maxCompletionTokens: model.maxCompletionTokens,
          inputPricePer1M: model.inputPricePer1M,
          outputPricePer1M: model.outputPricePer1M,
          supportsImages: model.supportsImages,
          supportsTools: model.supportsTools,
          supportedParameters: model.supportedParameters,
          architecture: model.architecture,
          lastSyncedAt: now,
        });
      }
    }
  },
});

// -- Public queries (re-exported from queries.ts) ----------------------------
// Clients reference "models/sync:listModels" etc. — keep re-exports here
// so existing iOS/Android constants don't need updating.

export { listModels, getModel, listModelSummaries } from "./queries";

// -- Helpers ------------------------------------------------------------------

function extractProvider(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.substring(0, slash) : "unknown";
}

function parsePricePer1M(priceStr: string | undefined): number | undefined {
  if (!priceStr) return undefined;
  const parsed = parseFloat(priceStr);
  if (isNaN(parsed)) return undefined;
  // OpenRouter returns price per token; convert to per 1M tokens
  return parsed * 1_000_000;
}
