// convex/models/openrouter_usecase_sync.ts
// =============================================================================
// Sync OpenRouter category result sets and store as trend hints on cachedModels.
//
// Endpoint: GET https://openrouter.ai/api/v1/models?category={category}
// Stores top 10 entries per category. Cadence: every 6 hours via cron.
// =============================================================================

import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { deepEqual } from "./sync_diff";

// -- Documented OpenRouter categories -----------------------------------------

const OPENROUTER_CATEGORIES = [
  "programming",
  "roleplay",
  "marketing",
  "technology",
  "science",
  "translation",
  "legal",
  "finance",
  "health",
  "trivia",
  "academia",
] as const;

const TOP_N = 10;

// -- Types --------------------------------------------------------------------

interface CategoryResult {
  category: string;
  modelIds: string[]; // ordered by API return order (rank)
}

// -- Sync action --------------------------------------------------------------

export const syncUseCases = internalAction({
  args: {},
  handler: async (ctx) => {
    const results: CategoryResult[] = [];

    // Fetch all categories sequentially to avoid rate limiting
    for (const category of OPENROUTER_CATEGORIES) {
      try {
        const response = await fetch(
          `https://openrouter.ai/api/v1/models?category=${category}`,
          {
            headers: {
              "HTTP-Referer": "https://nanthai.tech",
              "X-Title": "N:EDGE",
            },
          },
        );

        if (!response.ok) {
          console.warn(
            `OpenRouter category fetch failed for ${category}: ${response.status}`,
          );
          continue;
        }

        const data = await response.json();
        const models = data.data;

        if (!Array.isArray(models)) {
          console.warn(`OpenRouter category ${category}: unexpected response shape`);
          continue;
        }

        // Take top N model IDs in returned order
        const modelIds = models
          .slice(0, TOP_N)
          .map((m: any) => m.id as string)
          .filter((id: string) => typeof id === "string" && id.length > 0);

        results.push({ category, modelIds });
      } catch (err) {
        console.warn(`OpenRouter category fetch error for ${category}:`, err);
      }
    }

    if (results.length === 0) {
      console.warn("No OpenRouter category results — preserving existing hints");
      return;
    }

    await ctx.runMutation(
      internal.models.openrouter_usecase_sync.applyUseCases,
      { results },
    );
  },
});

// -- Apply use cases mutation -------------------------------------------------

export const applyUseCases = internalMutation({
  args: {
    results: v.array(
      v.object({
        category: v.string(),
        modelIds: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Build a map: modelId → array of { category, rank }
    const useCaseMap = new Map<
      string,
      { category: string; returnedRank: number; syncedAt: number }[]
    >();

    for (const result of args.results) {
      for (let i = 0; i < result.modelIds.length; i++) {
        const modelId = result.modelIds[i];
        if (!useCaseMap.has(modelId)) {
          useCaseMap.set(modelId, []);
        }
        useCaseMap.get(modelId)!.push({
          category: result.category,
          returnedRank: i + 1, // 1-based rank
          syncedAt: now,
        });
      }
    }

    // For each model that appears in any category result, update its useCases
    let updatedCount = 0;
    for (const [modelId, useCases] of useCaseMap) {
      const model = await ctx.db
        .query("cachedModels")
        .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
        .first();

      if (model) {
        if (!useCasesEqual(model.openRouterUseCases, useCases)) {
          await ctx.db.patch(model._id, {
            openRouterUseCases: useCases,
          });
          updatedCount++;
        }
      }
    }

    // Clear use cases for models no longer in any category result
    const allModels = await ctx.db.query("cachedModels").collect();
    let clearedCount = 0;
    for (const model of allModels) {
      if (
        model.openRouterUseCases &&
        model.openRouterUseCases.length > 0 &&
        !useCaseMap.has(model.modelId)
      ) {
        await ctx.db.patch(model._id, {
          openRouterUseCases: undefined,
        });
        clearedCount++;
      }
    }

    console.log(
      `Use-case sync complete: ${updatedCount} models enriched, ${clearedCount} cleared`,
    );
  },
});

function useCasesEqual(existing: unknown, next: unknown): boolean {
  return deepEqual(normalizeUseCases(existing), normalizeUseCases(next));
}

function normalizeUseCases(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      return entry;
    }

    const { syncedAt: _syncedAt, ...rest } = entry as Record<string, unknown>;
    return rest;
  });
}
