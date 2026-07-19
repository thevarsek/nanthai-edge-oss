import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { heartbeatExecution } from "../execution/control_plane";

async function authorize(
  ctx: MutationCtx,
  run: Doc<"analyticsWorkflowRuns">,
  claimantId: string,
): Promise<void> {
  await heartbeatExecution(ctx, {
    attemptId: run.executionAttemptId,
    fence: run.executionFence,
    claimantId,
    leaseMs: 12 * 60 * 1000,
  });
}

export const storeNormalized = internalMutation({
  args: {
    analyticsRunId: v.id("analyticsWorkflowRuns"),
    claimantId: v.string(),
    resultJson: v.optional(v.string()),
    resultStorageId: v.optional(v.id("_storage")),
    resultBytes: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.analyticsRunId);
    if (!run || run.status !== "running") return false;
    await authorize(ctx, run, args.claimantId);
    if (run.normalizedResultJson || run.normalizedResultStorageId) return false;
    await ctx.db.patch(run._id, {
      normalizedResultJson: args.resultJson,
      normalizedResultStorageId: args.resultStorageId,
      normalizedResultBytes: args.resultBytes,
      phase: "normalize",
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const persistNormalized = internalMutation({
  args: {
    analyticsRunId: v.id("analyticsWorkflowRuns"),
    claimantId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.analyticsRunId);
    if (!run || run.status !== "running") return null;
    await authorize(ctx, run, args.claimantId);
    if (!run.normalizedResultJson && !run.normalizedResultStorageId) {
      throw new Error("ANALYTICS_NORMALIZED_RESULT_MISSING");
    }
    await ctx.db.patch(run._id, {
      resultJson: run.normalizedResultJson,
      resultStorageId: run.normalizedResultStorageId,
      resultBytes: run.normalizedResultBytes,
      normalizedResultJson: undefined,
      normalizedResultStorageId: undefined,
      normalizedResultBytes: undefined,
      phase: "persist",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const attach = internalMutation({
  args: {
    analyticsRunId: v.id("analyticsWorkflowRuns"),
    claimantId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.analyticsRunId);
    if (!run || run.status !== "running") return 0;
    await authorize(ctx, run, args.claimantId);
    const artifacts = await ctx.db
      .query("toolExecutionArtifacts")
      .withIndex("by_tool_call", (q) => q.eq("toolCallId", run.toolCallId))
      .collect();
    const owned = artifacts.filter((artifact) =>
      artifact.jobId === run.jobId && artifact.userId === run.userId,
    );
    for (const artifact of owned) {
      await ctx.db.patch(artifact._id, {
        status: "completed",
        isError: undefined,
        errorMessage: undefined,
        resultRaw: run.resultJson,
        resultStorageId: run.resultStorageId,
        resultBytes: run.resultBytes,
        updatedAt: Date.now(),
      });
    }
    await ctx.db.patch(run._id, { phase: "attach", updatedAt: Date.now() });
    return owned.length;
  },
});
