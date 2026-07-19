import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export function researchSearchBatchTerminalEventName(batchId: string): string {
  return `research-search-batch-terminal:${batchId}`;
}

export const getResearchSearchBatch = internalQuery({
  args: { batchId: v.id("researchSearchBatches") },
  handler: async (ctx, args) => await ctx.db.get(args.batchId),
});

export const getResearchSearchBatchResults = internalQuery({
  args: { batchId: v.id("researchSearchBatches") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const tasks = await ctx.db
      .query("researchSearchTasks")
      .withIndex("by_batch", (query) => query.eq("batchId", args.batchId))
      .collect();
    return tasks.map((task) => task.result ?? {
      query: task.query,
      content: "",
      citations: [],
      success: false,
      error: task.error ?? "Search task did not complete",
    });
  },
});
