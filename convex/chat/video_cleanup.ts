import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { storageHasContentReferences } from "../knowledge_base/delete_helpers";

export async function ensureVideoProviderReconciliationRef(
  ctx: MutationCtx,
  args: {
    runId: Id<"executionRuns">;
    attemptId?: Id<"executionAttempts">;
    userId: string;
    videoJobId: Id<"videoJobs">;
    now: number;
  },
): Promise<void> {
  const operationId = `openrouter-video:${String(args.videoJobId)}`;
  const existing = await ctx.db
    .query("executionComponentRefs")
    .withIndex("by_operation", (query) => query
      .eq("adapterId", "external-cloud")
      .eq("operationId", operationId))
    .unique();
  if (existing) return;
  await ctx.db.insert("executionComponentRefs", {
    runId: args.runId,
    attemptId: args.attemptId,
    userId: args.userId,
    adapterId: "external-cloud",
    operationId,
    role: "video-provider-reconciliation",
    status: "cancel_requested",
    createdAt: args.now,
    updatedAt: args.now,
  });
}

export async function releaseVideoOutputUpload(
  ctx: MutationCtx,
  outputUploadId: Id<"videoOutputUploads">,
): Promise<void> {
  const upload = await ctx.db.get(outputUploadId);
  if (!upload) return;
  if (
    upload.storageId &&
    !(await storageHasContentReferences(ctx, upload.storageId))
  ) {
    await ctx.storage.delete(upload.storageId).catch(() => undefined);
  }
  await ctx.db.delete(upload._id);
}

export async function cancelVideoForExecutionRun(
  ctx: MutationCtx,
  executionRunId: Id<"executionRuns">,
): Promise<void> {
  const run = await ctx.db.get(executionRunId);
  if (run?.domainType !== "video_generation" || !run.domainId) return;
  const messageId = run.domainId as Id<"messages">;
  let videoJob = await ctx.db
    .query("videoJobs")
    .withIndex("by_execution_run", (q) => q.eq("executionRunId", executionRunId))
    .first();
  if (!videoJob) {
    const legacyJobs = await ctx.db
      .query("videoJobs")
      .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
      .collect();
    const unownedLegacyJobs = legacyJobs.filter((job) => job.executionRunId === undefined);
    videoJob = unownedLegacyJobs.length === 1 ? unownedLegacyJobs[0] : null;
  }
  if (videoJob && videoJob.status !== "completed" && videoJob.status !== "failed") {
    const now = Date.now();
    await ctx.db.patch(videoJob._id, {
      status: "failed",
      error: "Cancelled by user",
      cancellationRequestedAt: videoJob.cancellationRequestedAt ?? now,
      lastPolledAt: now,
    });
    if (videoJob.openRouterJobId && videoJob.providerTerminalAt === undefined) {
      await ensureVideoProviderReconciliationRef(ctx, {
        runId: run._id,
        attemptId: run.activeAttemptId,
        userId: run.userId,
        videoJobId: videoJob._id,
        now,
      });
    }
  }
  if (videoJob?.outputUploadId) {
    await releaseVideoOutputUpload(ctx, videoJob.outputUploadId);
    await ctx.db.patch(videoJob._id, { outputUploadId: undefined });
  }
}
