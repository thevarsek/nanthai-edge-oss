import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export const getRun = internalQuery({
  args: { analyticsRunId: v.id("analyticsWorkflowRuns") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => await ctx.db.get(args.analyticsRunId),
});

export const getStatus = internalQuery({
  args: { analyticsRunId: v.id("analyticsWorkflowRuns") },
  returns: v.union(
    v.object({
      status: v.union(
        v.literal("prepared"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
      phase: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.analyticsRunId);
    return run ? { status: run.status, phase: run.phase } : null;
  },
});

export const listArtifacts = internalQuery({
  args: { analyticsRunId: v.id("analyticsWorkflowRuns") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => await ctx.db
    .query("analyticsArtifactIntents")
    .withIndex("by_run", (q) => q.eq("analyticsRunId", args.analyticsRunId))
    .collect(),
});
