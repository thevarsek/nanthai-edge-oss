import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { assertCurrentFence } from "../execution/control_plane";
import { ensureVideoProviderReconciliationRef } from "../chat/video_cleanup";

type SubmissionIdentity = {
  videoJobId: Id<"videoJobs">;
  userId: string;
  generationJobId: Id<"generationJobs">;
  toolCallId: string;
  executionAttemptId: Id<"executionAttempts">;
};

async function ownedJob(ctx: MutationCtx, args: SubmissionIdentity) {
  const job = await ctx.db.get(args.videoJobId);
  if (
    !job || job.userId !== args.userId ||
    job.generationJobId !== args.generationJobId ||
    job.toolCallId !== args.toolCallId ||
    job.executionAttemptId !== args.executionAttemptId ||
    !job.executionRunId
  ) {
    throw new Error("TOOL_VIDEO_OWNERSHIP_MISMATCH");
  }
  return job as typeof job & { executionRunId: Id<"executionRuns"> };
}

export const createToolVideoOutputUploadSession = internalMutation({
  args: {
    videoJobId: v.id("videoJobs"),
    userId: v.string(),
    generationJobId: v.id("generationJobs"),
    toolCallId: v.string(),
    executionAttemptId: v.id("executionAttempts"),
    executionFence: v.number(),
    tokenHash: v.string(),
    expiresAt: v.number(),
  },
  returns: v.id("videoOutputUploads"),
  handler: async (ctx, args) => {
    await assertCurrentFence(ctx, args.executionAttemptId, args.executionFence);
    const job = await ownedJob(ctx, args);
    if (job.executionFence !== args.executionFence) {
      throw new Error("TOOL_VIDEO_OWNERSHIP_MISMATCH");
    }
    if (job.outputUploadId) {
      const previous = await ctx.db.get(job.outputUploadId);
      if (previous?.storageId || previous?.status === "uploaded") {
        throw new Error("TOOL_VIDEO_OUTPUT_UPLOAD_CONFLICT");
      }
      if (previous) await ctx.db.delete(previous._id);
    }
    const outputUploadId = await ctx.db.insert("videoOutputUploads", {
      tokenHash: args.tokenHash,
      messageId: job.messageId,
      chatId: job.chatId,
      userId: args.userId,
      status: "pending",
      executionRunId: job.executionRunId,
      executionAttemptId: args.executionAttemptId,
      executionFence: args.executionFence,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
    });
    await ctx.db.patch(job._id, { outputUploadId });
    return outputUploadId;
  },
});

export const recordToolVideoSubmissionOutcome = internalMutation({
  args: {
    videoJobId: v.id("videoJobs"),
    userId: v.string(),
    generationJobId: v.id("generationJobs"),
    toolCallId: v.string(),
    executionAttemptId: v.id("executionAttempts"),
    operationKey: v.string(),
    openRouterJobId: v.string(),
    outputUploadId: v.optional(v.id("videoOutputUploads")),
    resultJson: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ownedJob(ctx, args);
    const operation = await ctx.db
      .query("executionOperations")
      .withIndex("by_run_operation", (query) => query
        .eq("runId", job.executionRunId)
        .eq("operationKey", args.operationKey))
      .unique();
    if (
      !operation || operation.attemptId !== args.executionAttemptId ||
      operation.toolName !== "video_provider_submit" ||
      !["dispatching", "outcome_unknown", "succeeded", "reconciled"].includes(operation.status)
    ) {
      throw new Error("TOOL_VIDEO_OPERATION_MISMATCH");
    }
    if (operation.externalId && operation.externalId !== args.openRouterJobId) {
      throw new Error("TOOL_VIDEO_PROVIDER_CONFLICT");
    }
    if (job.openRouterJobId && job.openRouterJobId !== args.openRouterJobId) {
      throw new Error("TOOL_VIDEO_PROVIDER_CONFLICT");
    }
    if (job.outputUploadId && args.outputUploadId && job.outputUploadId !== args.outputUploadId) {
      throw new Error("TOOL_VIDEO_OUTPUT_UPLOAD_CONFLICT");
    }

    const now = Date.now();
    await ctx.db.patch(operation._id, {
      status: "reconciled",
      externalId: args.openRouterJobId.slice(0, 2_000),
      resultJson: args.resultJson.slice(0, 900_000),
      completedAt: operation.completedAt ?? now,
      updatedAt: now,
    });
    await ctx.db.patch(job._id, {
      openRouterJobId: args.openRouterJobId,
      outputUploadId: args.outputUploadId ?? job.outputUploadId,
      ...(!["completed", "failed"].includes(job.status)
        ? { status: "in_progress" as const, lastPolledAt: now }
        : {}),
    });

    const run = await ctx.db.get(job.executionRunId);
    const needsReconciliation = job.cancellationRequestedAt !== undefined
      || job.status === "failed"
      || !!run && ["cancelling", "cancelled", "failed", "completed"].includes(run.state);
    if (needsReconciliation && job.providerTerminalAt === undefined) {
      await ensureVideoProviderReconciliationRef(ctx, {
        runId: job.executionRunId,
        attemptId: args.executionAttemptId,
        userId: args.userId,
        videoJobId: job._id,
        now,
      });
    }
    return null;
  },
});
