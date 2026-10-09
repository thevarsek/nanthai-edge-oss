// Daily at 02:00 UTC. Uses the existing server-side key on the Free v2 endpoints.
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { prepareBenchmarkUpdates } from "./artificial_analysis_prepare";
import { fetchImageBenchmarks, fetchLanguageBenchmarks } from "./artificial_analysis_api";
import type { BenchmarkSyncArgs } from "./artificial_analysis_contract";

export const syncBenchmarks = internalAction({
  args: {},
  handler: async (ctx) => {
    const apiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
    if (!apiKey) {
      console.warn("ARTIFICIAL_ANALYSIS_API_KEY not set — skipping benchmark sync");
      return;
    }
    // Each promise includes parsing and all pages: never publish a partial category.
    const [language, image] = await Promise.allSettled([
      fetchLanguageBenchmarks(apiKey), fetchImageBenchmarks(apiKey),
    ]);
    const unavailableCategories: NonNullable<BenchmarkSyncArgs["unavailableCategories"]> = [];
    const llmModels = language.status === "fulfilled" ? language.value : [];
    const imageModels = image.status === "fulfilled" ? image.value : [];
    if (!llmModels.length) {
      unavailableCategories.push("language");
      console.warn("AA language snapshot unavailable or empty — keeping last snapshot");
    }
    if (!imageModels.length) {
      unavailableCategories.push("image");
      console.warn("AA image snapshot unavailable or empty — keeping last snapshot");
    }
    if (!llmModels.length && !imageModels.length) return;

    const allModels = await ctx.runQuery(internal.models.queries.listModelsInternalForSync, {});
    const prepared = prepareBenchmarkUpdates(allModels, {
      llmModels, imageModels, unavailableCategories,
    }, Date.now());
    await ctx.runMutation(internal.models.artificial_analysis_apply.applyBenchmarks, {
      matchedCount: prepared.matchedCount,
      totalModels: prepared.totalModels,
      patches: prepared.patches.map((entry) => ({
        docId: entry.docId as Id<"cachedModels">,
        patch: entry.patch,
      })),
    });
  },
});
