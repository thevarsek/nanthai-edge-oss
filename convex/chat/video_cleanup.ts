import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function cancelVideoForExecutionRun(
  ctx: MutationCtx,
  executionRunId: Id<"executionRuns">,
): Promise<void> {
  const run = await ctx.db.get(executionRunId);
  if (run?.domainType !== "video_generation" || !run.domainId) return;
  const messageId = run.domainId as Id<"messages">;
  const videoJob = await ctx.db
    .query("videoJobs")
    .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
    .order("desc")
    .first();
  if (videoJob && videoJob.providerTerminalAt === undefined) {
    const now = Date.now();
    await ctx.db.patch(videoJob._id, {
      status: "failed",
      error: "Cancelled by user",
      cancellationRequestedAt: videoJob.cancellationRequestedAt ?? now,
      lastPolledAt: now,
    });
    const operationId = `openrouter-video:${String(videoJob._id)}`;
    const existing = await ctx.db
      .query("executionComponentRefs")
      .withIndex("by_operation", (q) => q
        .eq("adapterId", "external-cloud")
        .eq("operationId", operationId))
      .unique();
    if (!existing) {
      await ctx.db.insert("executionComponentRefs", {
        runId: run._id,
        attemptId: run.activeAttemptId,
        userId: run.userId,
        adapterId: "external-cloud",
        operationId,
        role: "video-provider-reconciliation",
        status: "cancel_requested",
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  const upload = await ctx.db
    .query("videoOutputUploads")
    .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
    .first();
  if (upload?.storageId) await ctx.storage.delete(upload.storageId).catch(() => undefined);
  if (upload) await ctx.db.delete(upload._id);
}
