// convex/jobs/cleanup.ts
// =============================================================================
// Stale job cleanup: cancels generation jobs stuck in "queued" or "streaming"
// state for too long. Called by cron every 15 minutes.
// =============================================================================

import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { MAX_CONSECUTIVE_FAILURES } from "../scheduledJobs/actions_lifecycle";
import { cancelGenerationContinuationHandler } from "../chat/mutations_generation_continuation_handlers";
import {
  GENERATION_CONTINUATION_LEASE_MS,
  TERMINAL_GENERATION_JOB_STATUSES,
} from "../chat/generation_continuation_shared";

const STALE_QUEUED_JOB_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const STALE_STREAMING_JOB_TIMEOUT_MS = 45 * 60 * 1000; // 45 minutes
const STALE_ERROR = "Timed out (stale job cleanup)";

async function releaseScheduledExecutionForStaleJob(
  ctx: any,
  generationJob: any,
  now: number,
): Promise<void> {
  if (!generationJob.sourceJobId || !generationJob.sourceExecutionId) {
    return;
  }

  const scheduledJob = await ctx.db.get(generationJob.sourceJobId);
  if (!scheduledJob) {
    return;
  }
  if (scheduledJob.activeExecutionId !== generationJob.sourceExecutionId) {
    return;
  }
  if (
    scheduledJob.activeGenerationJobId
    && scheduledJob.activeGenerationJobId !== generationJob._id
  ) {
    return;
  }

  const startedAt = scheduledJob.activeExecutionStartedAt ?? now;
  const failures = (scheduledJob.consecutiveFailures ?? 0) + 1;
  const autoPause = failures >= MAX_CONSECUTIVE_FAILURES;

  await ctx.db.insert("jobRuns", {
    jobId: scheduledJob._id,
    userId: scheduledJob.userId,
    chatId: scheduledJob.activeExecutionChatId,
    status: "failed",
    error: STALE_ERROR,
    startedAt,
    completedAt: now,
    durationMs: now - startedAt,
  });

  if (autoPause && scheduledJob.scheduledFunctionId) {
    try {
      await ctx.scheduler.cancel(scheduledJob.scheduledFunctionId);
    } catch {
      // Already executed or cancelled.
    }
  }

  const patch: Record<string, unknown> = {
    lastRunAt: now,
    lastRunChatId: scheduledJob.activeExecutionChatId,
    lastRunStatus: "failed",
    lastRunError: STALE_ERROR,
    consecutiveFailures: failures,
    status: autoPause ? "error" : scheduledJob.status,
    totalRuns: (scheduledJob.totalRuns ?? 0) + 1,
    activeExecutionId: undefined,
    activeExecutionChatId: undefined,
    activeExecutionStartedAt: undefined,
    activeStepIndex: undefined,
    activeStepCount: undefined,
    activeUserMessageId: undefined,
    activeAssistantMessageId: undefined,
    activeGenerationJobId: undefined,
    updatedAt: now,
  };

  if (autoPause) {
    patch.nextRunAt = undefined;
    patch.scheduledFunctionId = undefined;
  }

  await ctx.db.patch(scheduledJob._id, patch);
}

/** Clean up stale generation jobs. */
export const cleanStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Candidate jobs still in non-terminal states — use by_status index.
    const BATCH_PER_STATUS = 150;
    const [queuedJobs, streamingJobs] = await Promise.all([
      ctx.db
        .query("generationJobs")
        .withIndex("by_status", (q) => q.eq("status", "queued"))
        .take(BATCH_PER_STATUS),
      ctx.db
        .query("generationJobs")
        .withIndex("by_status", (q) => q.eq("status", "streaming"))
        .take(BATCH_PER_STATUS),
    ]);
    const candidateJobs = [...queuedJobs, ...streamingJobs];

    let cleaned = 0;

    for (const job of candidateJobs) {
      const timeoutMs = job.status === "streaming"
        ? STALE_STREAMING_JOB_TIMEOUT_MS
        : STALE_QUEUED_JOB_TIMEOUT_MS;
      const referenceTime = job.status === "streaming"
        ? (job.startedAt ?? job.createdAt)
        : job.createdAt;
      if (now - referenceTime < timeoutMs) {
        continue;
      }

      await cancelGenerationContinuationHandler(ctx, {
        jobId: job._id,
      });

      // Mark job as failed
      await ctx.db.patch(job._id, {
        status: "failed",
        error: STALE_ERROR,
        completedAt: now,
        scheduledFunctionId: undefined,
      });

      // Also mark the corresponding message as failed
      const msg = await ctx.db.get(job.messageId);
      if (msg && (msg.status === "pending" || msg.status === "streaming")) {
        await ctx.db.patch(job.messageId, {
          status: "failed",
          content: msg.content || "[Generation timed out — please try again]",
        });

        // Keep search session state in sync for paper/web flows.
        if (msg.searchSessionId) {
          const session = await ctx.db.get(msg.searchSessionId);
          if (session && session.status !== "completed" && session.status !== "cancelled" && session.status !== "failed") {
            await ctx.db.patch(msg.searchSessionId, {
              status: "failed",
              currentPhase: "failed",
              errorMessage: "Generation timed out (stale job cleanup)",
              completedAt: now,
            });
          }
        }
      }

      await releaseScheduledExecutionForStaleJob(ctx, job, now);

      cleaned++;
    }

    if (cleaned > 0) {
      console.log(`Cleaned ${cleaned} stale generation jobs`);
    }

    // If either status hit its batch limit, there may be more — self-schedule a continuation
    if (queuedJobs.length === BATCH_PER_STATUS || streamingJobs.length === BATCH_PER_STATUS) {
      await ctx.scheduler.runAfter(0, internal.jobs.cleanup.cleanStale, {});
    }

    // ── Orphaned continuation reaping ────────────────────────────────────
    // Clean up generationContinuations rows whose parent job is already
    // terminal, or whose lease expired long ago with no re-claim.
    const ORPHAN_BATCH = 100;
    const orphanCutoff = now - GENERATION_CONTINUATION_LEASE_MS * 2; // 24 min grace

    const [waitingOrphans, runningOrphans] = await Promise.all([
      ctx.db
        .query("generationContinuations")
        .withIndex("by_status", (q) => q.eq("status", "waiting"))
        .take(ORPHAN_BATCH),
      ctx.db
        .query("generationContinuations")
        .withIndex("by_status", (q) => q.eq("status", "running"))
        .take(ORPHAN_BATCH),
    ]);

    let orphansCleaned = 0;
    for (const cont of [...waitingOrphans, ...runningOrphans]) {
      const job = await ctx.db.get(cont.jobId);

      // Parent job gone or terminal → orphan.
      const jobTerminal = !job || TERMINAL_GENERATION_JOB_STATUSES.has(job.status);
      // Lease expired long ago and nothing re-claimed → stuck.
      const leaseStale =
        cont.status === "running"
        && cont.leaseExpiresAt != null
        && cont.leaseExpiresAt < orphanCutoff;
      // Waiting too long without being claimed → stuck.
      const waitingStale =
        cont.status === "waiting"
        && cont.updatedAt < orphanCutoff;

      if (!jobTerminal && !leaseStale && !waitingStale) {
        continue;
      }

      // Cancel the scheduled function if one is recorded.
      if (cont.scheduledFunctionId) {
        try {
          await ctx.scheduler.cancel(cont.scheduledFunctionId);
        } catch {
          // Already executed or cancelled.
        }
      }
      if (job?.scheduledFunctionId) {
        await ctx.db.patch(job._id, { scheduledFunctionId: undefined });
      }
      await ctx.db.delete(cont._id);
      orphansCleaned++;
    }

    if (orphansCleaned > 0) {
      console.log(`Cleaned ${orphansCleaned} orphaned generation continuations`);
    }
  },
});
