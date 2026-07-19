import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { heartbeatExecution } from "../execution/control_plane";
import { ANALYTICS_ARTIFACT_MAX_BYTES } from "./limits";

const kind = v.union(v.literal("chart"), v.literal("output"));

export async function prepareArtifactIntent(
  ctx: MutationCtx,
  args: {
    analyticsRunId: Id<"analyticsWorkflowRuns">;
    claimantId: string;
    ordinal: number;
    kind: "chart" | "output";
    filename: string;
    mimeType: string;
    sizeBytes: number;
  },
): Promise<{ intentId: Id<"analyticsArtifactIntents">; storageId?: Id<"_storage"> }> {
  const run = await ctx.db.get(args.analyticsRunId);
  if (!run || run.status !== "running") throw new Error("ANALYTICS_RUN_NOT_WRITABLE");
  if (args.sizeBytes < 0 || args.sizeBytes > ANALYTICS_ARTIFACT_MAX_BYTES) {
    throw new Error("ANALYTICS_ARTIFACT_TOO_LARGE");
  }
  await heartbeatExecution(ctx, {
    attemptId: run.executionAttemptId,
    fence: run.executionFence,
    claimantId: args.claimantId,
    leaseMs: 12 * 60 * 1000,
  });
  const artifactKey = `${run.artifactKey}:${args.kind}:${args.ordinal}`;
  const existing = await ctx.db
    .query("analyticsArtifactIntents")
    .withIndex("by_key", (q) => q.eq("artifactKey", artifactKey))
    .unique();
  if (existing) return { intentId: existing._id, storageId: existing.storageId };
  const now = Date.now();
  const intentId = await ctx.db.insert("analyticsArtifactIntents", {
    analyticsRunId: run._id,
    userId: run.userId,
    artifactKey,
    ordinal: args.ordinal,
    kind: args.kind,
    filename: args.filename,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
    status: "planned",
    createdAt: now,
    updatedAt: now,
  });
  return { intentId };
}

export const prepare = internalMutation({
  args: {
    analyticsRunId: v.id("analyticsWorkflowRuns"),
    claimantId: v.string(),
    ordinal: v.number(),
    kind,
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
  },
  returns: v.object({
    intentId: v.id("analyticsArtifactIntents"),
    storageId: v.optional(v.id("_storage")),
  }),
  handler: async (ctx, args) => await prepareArtifactIntent(ctx, args),
});

export const commit = internalMutation({
  args: {
    analyticsRunId: v.id("analyticsWorkflowRuns"),
    claimantId: v.string(),
    intentId: v.id("analyticsArtifactIntents"),
    storageId: v.id("_storage"),
  },
  returns: v.id("_storage"),
  handler: async (ctx, args) => {
    const [run, intent] = await Promise.all([
      ctx.db.get(args.analyticsRunId),
      ctx.db.get(args.intentId),
    ]);
    if (!run || !intent || intent.analyticsRunId !== run._id) {
      throw new Error("ANALYTICS_ARTIFACT_INTENT_NOT_FOUND");
    }
    await heartbeatExecution(ctx, {
      attemptId: run.executionAttemptId,
      fence: run.executionFence,
      claimantId: args.claimantId,
      leaseMs: 12 * 60 * 1000,
    });
    if (intent.storageId) return intent.storageId;
    await ctx.db.patch(intent._id, {
      storageId: args.storageId,
      status: "stored",
      updatedAt: Date.now(),
    });
    return args.storageId;
  },
});
