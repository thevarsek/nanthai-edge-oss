// convex/models/sync.ts
// =============================================================================
// Model catalog sync: fetches OpenRouter /api/v1/models and upserts into
// cachedModels table. Called by cron every 4 hours.
//
// Hash-based skip: computes a SHA-256 hash of the sorted model IDs + pricing
// from the API response. If the hash matches the last-seen value stored in
// syncMeta, the entire upsertBatch loop is skipped — saving ~250 MB/month
// in DB bandwidth from reads that produce no writes.
//
// This eliminates per-user model catalog fetches — all clients subscribe
// to queries.listModels() reactively.
// =============================================================================

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { filterExcludedOpenRouterProviders } from "./provider_filters";
import { hasFieldsChanged, primitiveArraysEqual, deepEqual } from "./sync_diff";
import { HTTP_REFERER, X_TITLE } from "../lib/openrouter_constants";

// -- Sync metadata helpers ----------------------------------------------------

/** Read the current catalog hash from syncMeta. */
export const getCatalogHash = internalQuery({
  args: {},
  handler: async (ctx) => {
    const meta = await ctx.db
      .query("syncMeta")
      .withIndex("by_key", (q) => q.eq("key", "modelCatalog"))
      .first();
    return meta?.contentHash ?? null;
  },
});

/** Store the catalog hash in syncMeta (upsert). */
export const setCatalogHash = internalMutation({
  args: { contentHash: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("syncMeta")
      .withIndex("by_key", (q) => q.eq("key", "modelCatalog"))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        contentHash: args.contentHash,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("syncMeta", {
        key: "modelCatalog",
        contentHash: args.contentHash,
        updatedAt: Date.now(),
      });
    }
  },
});

// -- Model sync action --------------------------------------------------------

export const syncFromOpenRouter = internalAction({
  args: {},
  handler: async (ctx) => {
    // Fetch the OpenRouter model catalog
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        "HTTP-Referer": HTTP_REFERER,
        "X-Title": X_TITLE,
      },
    });

    if (!response.ok) {
      console.error(
        `Model catalog sync failed: ${response.status} ${response.statusText}`,
      );
      return;
    }

    const data = await response.json();
    const rawModels = Array.isArray(data.data) ? data.data : [];

    // Compute a content hash from the fields we actually sync.
    // Sorted by model ID for deterministic ordering.
    const hashInput = rawModels
      .map((m: any) => `${m.id}|${m.name}|${m.pricing?.prompt}|${m.pricing?.completion}|${m.context_length}|${(m.supported_parameters ?? []).join(",")}`)
      .sort()
      .join("\n");
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(hashInput),
    );
    const contentHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Check if the catalog has changed since last sync
    const previousHash = await ctx.runQuery(
      internal.models.sync.getCatalogHash,
      {},
    );

    // Fetch ZDR endpoint list and build a set of model IDs that support ZDR.
    // This runs regardless of catalog hash so ZDR changes are always picked up.
    const zdrModelIds = new Set<string>();
    try {
      const zdrResponse = await fetch("https://openrouter.ai/api/v1/endpoints/zdr", {
        headers: {
          "HTTP-Referer": HTTP_REFERER,
          "X-Title": X_TITLE,
        },
      });
      if (zdrResponse.ok) {
        const zdrData = await zdrResponse.json();
        const zdrEndpoints = Array.isArray(zdrData.data) ? zdrData.data : [];
        for (const ep of zdrEndpoints) {
          if (typeof ep.model_id === "string") {
            zdrModelIds.add(ep.model_id);
          }
        }
        console.log(`ZDR endpoint sync: ${zdrModelIds.size} models with ZDR`);
      } else {
        console.warn(`ZDR endpoint fetch failed: ${zdrResponse.status} — proceeding without ZDR data`);
      }
    } catch (e) {
      console.warn("ZDR endpoint fetch error — proceeding without ZDR data:", e);
    }

    if (previousHash === contentHash) {
      // Catalog unchanged — only refresh ZDR flags if we got data
      if (zdrModelIds.size > 0) {
        await ctx.runMutation(internal.models.sync.refreshZdrFlags, {
          zdrModelIds: [...zdrModelIds],
        });
        console.log("Model catalog unchanged (hash match) — ZDR flags refreshed");
      } else {
        console.log("Model catalog unchanged (hash match) — skipping upsert");
      }
      return;
    }

    const models = filterExcludedOpenRouterProviders(
      rawModels.map((model: Record<string, unknown>) => ({
        ...model,
        provider: extractProvider((model.id as string) ?? ""),
      })),
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
          supportsVideo: (() => {
            const modality = m.architecture?.modality ?? "";
            const parts = modality.split("->");
            return parts.length >= 2 && parts[1].includes("video");
          })(),
          hasZdrEndpoint: zdrModelIds.size > 0 ? zdrModelIds.has(m.id ?? "") : undefined,
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

    // Store the new hash only after successful upsert
    await ctx.runMutation(internal.models.sync.setCatalogHash, {
      contentHash,
    });

    // Prune models that are no longer in the OpenRouter catalog.
    // Collect all incoming model IDs into a set, then delete DB rows
    // whose modelId is absent. Done in batches to respect mutation limits.
    const incomingModelIds = new Set(models.map((m: any) => m.id as string));
    await ctx.runMutation(internal.models.sync.pruneStaleModels, {
      activeModelIds: [...incomingModelIds],
    });

    console.log(`Model catalog synced: ${models.length} models (hash updated)`);
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
        supportsVideo: v.optional(v.boolean()),
        hasZdrEndpoint: v.optional(v.boolean()),
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
            "supportsVideo",
            "hasZdrEndpoint",
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
            supportsVideo: model.supportsVideo,
            hasZdrEndpoint: model.hasZdrEndpoint,
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
          supportsVideo: model.supportsVideo,
          hasZdrEndpoint: model.hasZdrEndpoint,
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

// -- Prune stale models -------------------------------------------------------

export const pruneStaleModels = internalMutation({
  args: {
    activeModelIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const activeSet = new Set(args.activeModelIds);
    // Scan the full table and delete any model not in the active set.
    // Skip video-only models (managed by video_sync.ts) — they don't appear
    // in the general /api/v1/models endpoint and have videoCapabilities set.
    // cachedModels is typically ~300-400 rows, well within a single mutation.
    const allModels = await ctx.db.query("cachedModels").collect();
    let deleted = 0;
    for (const model of allModels) {
      if (!activeSet.has(model.modelId) && !model.videoCapabilities) {
        await ctx.db.delete(model._id);
        deleted++;
      }
    }
    if (deleted > 0) {
      console.log(`Pruned ${deleted} stale models from cachedModels`);
    }
  },
});

// -- Refresh ZDR flags only (when catalog hash is unchanged) ------------------

export const refreshZdrFlags = internalMutation({
  args: {
    zdrModelIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const zdrSet = new Set(args.zdrModelIds);
    const allModels = await ctx.db.query("cachedModels").collect();
    let updated = 0;
    for (const model of allModels) {
      const shouldHaveZdr = zdrSet.has(model.modelId);
      if (model.hasZdrEndpoint !== shouldHaveZdr) {
        await ctx.db.patch(model._id, { hasZdrEndpoint: shouldHaveZdr });
        updated++;
      }
    }
    if (updated > 0) {
      console.log(`ZDR flags refreshed: ${updated} models updated`);
    }
  },
});

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
