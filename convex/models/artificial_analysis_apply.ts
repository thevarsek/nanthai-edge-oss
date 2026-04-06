// convex/models/artificial_analysis_apply.ts
// =============================================================================
// Apply prepared benchmark patches to cached models.
// =============================================================================

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const applyBenchmarks = internalMutation({
  args: {
    matchedCount: v.number(),
    totalModels: v.number(),
    patches: v.array(
      v.object({
        docId: v.id("cachedModels"),
        patch: v.any(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const entry of args.patches) {
      await ctx.db.patch(entry.docId, entry.patch);
    }

    console.log(
      `Benchmark sync complete: ${args.matchedCount}/${args.totalModels} models matched`,
    );
  },
});
