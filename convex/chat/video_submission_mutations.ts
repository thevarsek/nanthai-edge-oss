import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { ensureVideoProviderReconciliationRef } from "./video_cleanup";

type DirectSubmissionOutcomeArgs = {
  videoJobId: Id<"videoJobs">;
  userId: string;
  generationJobId: Id<"generationJobs">;
  openRouterJobId: string;
  outputUploadId?: Id<"videoOutputUploads">;
  executionAttemptId?: Id<"executionAttempts">;
  operationKey?: string;
  resultJson?: string;
};

async function recordDirectVideoSubmissionOutcomeHandler(
  ctx: MutationCtx,
  args: DirectSubmissionOutcomeArgs,
): Promise<void> {
  const job = await ctx.db.get(args.videoJobId);
  if (
    !job || job.userId !== args.userId ||
    job.generationJobId !== args.generationJobId
  ) {
    throw new Error("VIDEO_JOB_OWNERSHIP_MISMATCH");
  }
  if (job.openRouterJobId && job.openRouterJobId !== args.openRouterJobId) {
    throw new Error("VIDEO_PROVIDER_SUBMISSION_CONFLICT");
  }
  if (job.outputUploadId && args.outputUploadId && job.outputUploadId !== args.outputUploadId) {
    throw new Error("VIDEO_OUTPUT_UPLOAD_CONFLICT");
  }

  if (job.executionRunId) {
    const executionRunId = job.executionRunId;
    if (!args.executionAttemptId || !args.operationKey || !args.resultJson) {
      throw new Error("VIDEO_OPERATION_IDENTITY_REQUIRED");
    }
    const operationKey = args.operationKey;
    const operation = await ctx.db
      .query("executionOperations")
      .withIndex("by_run_operation", (query) => query
        .eq("runId", executionRunId)
        .eq("operationKey", operationKey))
      .unique();
    if (
      !operation || operation.attemptId !== args.executionAttemptId ||
      operation.toolName !== "video_provider_submit" ||
      !["dispatching", "outcome_unknown", "succeeded", "reconciled"].includes(operation.status)
    ) {
      throw new Error("VIDEO_OPERATION_MISMATCH");
    }
    if (operation.externalId && operation.externalId !== args.openRouterJobId) {
      throw new Error("VIDEO_PROVIDER_SUBMISSION_CONFLICT");
    }
    const now = Date.now();
    await ctx.db.patch(operation._id, {
      status: "reconciled",
      externalId: args.openRouterJobId.slice(0, 2_000),
      resultJson: args.resultJson.slice(0, 900_000),
      completedAt: operation.completedAt ?? now,
      updatedAt: now,
    });
  }

  const now = Date.now();
  await ctx.db.patch(job._id, {
    openRouterJobId: args.openRouterJobId,
    outputUploadId: args.outputUploadId ?? job.outputUploadId,
    ...(!["completed", "failed"].includes(job.status)
      ? { status: "in_progress" as const, lastPolledAt: now }
      : {}),
  });

  const run = job.executionRunId ? await ctx.db.get(job.executionRunId) : null;
  const needsReconciliation = job.cancellationRequestedAt !== undefined ||
    job.status === "failed" ||
    !!run && ["cancelling", "cancelled", "failed", "completed"].includes(run.state);
  if (needsReconciliation && job.providerTerminalAt === undefined && job.executionRunId) {
    await ensureVideoProviderReconciliationRef(ctx, {
      runId: job.executionRunId,
      attemptId: args.executionAttemptId,
      userId: args.userId,
      videoJobId: job._id,
      now,
    });
  }
}

export const recordDirectVideoSubmissionOutcome = internalMutation({
  args: {
    videoJobId: v.id("videoJobs"),
    userId: v.string(),
    generationJobId: v.id("generationJobs"),
    openRouterJobId: v.string(),
    outputUploadId: v.optional(v.id("videoOutputUploads")),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    operationKey: v.optional(v.string()),
    resultJson: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordDirectVideoSubmissionOutcomeHandler(ctx, args);
    return null;
  },
});

export { recordDirectVideoSubmissionOutcomeHandler };
