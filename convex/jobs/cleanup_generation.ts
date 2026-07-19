import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { cancelGenerationContinuationHandler } from "../chat/mutations_generation_continuation_handlers";
import { reconcileGenerationTerminalHooks } from "../chat/generation_terminal_hooks";
import { finalizeGenerationHandler } from "../chat/mutations_internal_handlers";
import { claimExecutionRun } from "../execution/attempts";

const STALE_QUEUED_JOB_TIMEOUT_MS = 10 * 60 * 1000;
const STALE_STREAMING_JOB_TIMEOUT_MS = 45 * 60 * 1000;
const STALE_ERROR = "Timed out after durable execution activity stopped";

export const cleanStaleGenerationJob = internalMutation({
  args: { jobId: v.id("generationJobs") },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const now = Date.now();
    const job = await ctx.db.get(args.jobId);
    if (!job || (job.status !== "queued" && job.status !== "streaming")) {
      return false;
    }
    const continuation = await ctx.db
      .query("generationContinuations")
      .withIndex("by_job", (query) => query.eq("jobId", job._id))
      .first();
    // A deferred event is an intentional durable wait for a user or owned child.
    // It has no generic wall-clock expiry; the owning domain controls cancellation.
    if (continuation?.deferredResumeEventId) return false;

    const attempt = job.executionAttemptId
      ? await ctx.db.get(job.executionAttemptId)
      : null;
    const latestActivityAt = Math.max(
      job.startedAt ?? job.createdAt,
      continuation?.updatedAt ?? 0,
      attempt?.heartbeatAt ?? 0,
      attempt?.updatedAt ?? 0,
    );
    const timeoutMs = job.status === "streaming"
      ? STALE_STREAMING_JOB_TIMEOUT_MS
      : STALE_QUEUED_JOB_TIMEOUT_MS;
    if (now - latestActivityAt < timeoutMs) return false;

    const message = await ctx.db.get(job.messageId);
    const group = continuation?.groupSnapshot as {
      assistantMessageIds?: Id<"messages">[];
      generationJobIds?: Id<"generationJobs">[];
      userMessageId?: Id<"messages">;
      userId?: string;
      searchSessionId?: Id<"searchSessions">;
      subagentBatchId?: Id<"subagentBatches">;
      drivePickerBatchId?: Id<"drivePickerBatches">;
    } | undefined;
    let executionAttemptId: Id<"executionAttempts"> | undefined;
    let executionFence: number | undefined;
    let terminalStatus: "failed" | "cancelled" = "failed";
    let skipExecutionTerminalization = false;

    if (job.executionRunId) {
      const run = await ctx.db.get(job.executionRunId);
      if (!run || ["completed", "failed", "cancelled"].includes(run.state)) {
        skipExecutionTerminalization = true;
      } else if (run.state === "cancelling") {
        terminalStatus = "cancelled";
        skipExecutionTerminalization = true;
        await ctx.scheduler.runAfter(0, internal.execution.teardown.cancelRunTree, {
          runId: run._id,
          requestedBy: "stale-generation-cleanup",
          reason: "Finish previously requested generation cancellation",
        });
      } else {
        const claimed = await claimExecutionRun(ctx, {
          runId: run._id,
          claimantId: `stale-generation-cleanup:${String(job._id)}`,
          now,
        });
        if (!claimed) return false;
        executionAttemptId = claimed.attemptId;
        executionFence = claimed.fence;
        await ctx.db.patch(job._id, {
          executionAttemptId: claimed.attemptId,
          executionFence: claimed.fence,
        });
      }
    }

    await cancelGenerationContinuationHandler(ctx, { jobId: job._id });
    await finalizeGenerationHandler(ctx, {
      messageId: job.messageId,
      jobId: job._id,
      chatId: job.chatId,
      content: message?.content || (terminalStatus === "cancelled"
        ? "[Generation cancelled]"
        : "[Generation timed out — please try again]"),
      status: terminalStatus,
      error: terminalStatus === "failed" ? STALE_ERROR : undefined,
      userId: job.userId,
      executionAttemptId,
      executionFence,
      skipExecutionTerminalization,
      allowExpiredExecutionLease: true,
    });
    await reconcileGenerationTerminalHooks(ctx, {
      assistantMessageIds: group?.assistantMessageIds ?? [job.messageId],
      generationJobIds: group?.generationJobIds ?? [job._id],
      chatId: job.chatId,
      userMessageId: group?.userMessageId
        ?? message?.parentMessageIds?.[0]
        ?? job.messageId,
      userId: group?.userId ?? job.userId,
      searchSessionId: group?.searchSessionId ?? message?.searchSessionId,
      subagentBatchId: group?.subagentBatchId,
      drivePickerBatchId: group?.drivePickerBatchId,
    });
    return true;
  },
});
