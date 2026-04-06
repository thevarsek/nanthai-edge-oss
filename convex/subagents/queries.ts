import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";
import { optionalAuth } from "../lib/auth";

export const getBatchView = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const auth = await optionalAuth(ctx);
    if (!auth) return null;

    const message = await ctx.db.get(args.messageId);
    if (!message || message.userId !== auth.userId || !message.subagentBatchId) {
      return null;
    }

    const batch = await ctx.db.get(message.subagentBatchId);
    if (!batch || batch.userId !== auth.userId) return null;

    const runs = await ctx.db
      .query("subagentRuns")
      .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
      .collect();

    return {
      batch: {
        _id: batch._id,
        parentMessageId: batch.parentMessageId,
        status: batch.status,
        childCount: batch.childCount,
        completedChildCount: batch.completedChildCount,
        failedChildCount: batch.failedChildCount,
        updatedAt: batch.updatedAt,
      },
      runs: runs.map((run) => ({
        _id: run._id,
        batchId: run.batchId,
        childIndex: run.childIndex,
        title: run.title,
        taskPrompt: run.taskPrompt,
        status: run.status,
        content: run.content,
        reasoning: run.reasoning,
        error: run.error,
        updatedAt: run.updatedAt,
      })),
    };
  },
});

export const getBatchInternal = internalQuery({
  args: { batchId: v.id("subagentBatches") },
  handler: async (ctx, args) => ctx.db.get(args.batchId),
});

export const getRunInternal = internalQuery({
  args: { runId: v.id("subagentRuns") },
  handler: async (ctx, args) => ctx.db.get(args.runId),
});

export const listRunsForBatchInternal = internalQuery({
  args: { batchId: v.id("subagentBatches") },
  handler: async (ctx, args) =>
    ctx.db
      .query("subagentRuns")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect(),
});
