// convex/jobs/cleanup.ts
// =============================================================================
// Stale job cleanup: cancels generation jobs stuck in "queued" or "streaming"
// state for too long. Called by cron every 15 minutes.
// =============================================================================

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  GENERATION_CONTINUATION_LEASE_MS,
  TERMINAL_GENERATION_JOB_STATUSES,
} from "../chat/generation_continuation_shared";

/** Clean up stale generation jobs. */
export const cleanStale = internalMutation({
  args: {
    queuedCursor: v.optional(v.string()),
    streamingCursor: v.optional(v.string()),
    queuedDone: v.optional(v.boolean()),
    streamingDone: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const BATCH_PER_STATUS = 75;
    const [queuedPage, streamingPage] = await Promise.all([
      args.queuedDone
        ? Promise.resolve({ page: [], continueCursor: args.queuedCursor ?? "", isDone: true })
        : ctx.db
        .query("generationJobs")
        .withIndex("by_status", (q) => q.eq("status", "queued"))
        .paginate({ cursor: args.queuedCursor ?? null, numItems: BATCH_PER_STATUS }),
      args.streamingDone
        ? Promise.resolve({ page: [], continueCursor: args.streamingCursor ?? "", isDone: true })
        : ctx.db
        .query("generationJobs")
        .withIndex("by_status", (q) => q.eq("status", "streaming"))
        .paginate({ cursor: args.streamingCursor ?? null, numItems: BATCH_PER_STATUS }),
    ]);
    for (const job of [...queuedPage.page, ...streamingPage.page]) {
      await ctx.scheduler.runAfter(0, internal.jobs.cleanup_generation.cleanStaleGenerationJob, {
        jobId: job._id,
      });
    }

    if (!queuedPage.isDone || !streamingPage.isDone) {
      await ctx.scheduler.runAfter(0, internal.jobs.cleanup.cleanStale, {
        queuedCursor: queuedPage.continueCursor,
        streamingCursor: streamingPage.continueCursor,
        queuedDone: queuedPage.isDone,
        streamingDone: streamingPage.isDone,
      });
    }

    // ── Orphaned continuation reaping ────────────────────────────────────
    // Clean up generationContinuations rows whose parent job is already
    // terminal, or whose lease expired long ago with no re-claim.
    if (args.queuedCursor || args.streamingCursor) return;
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
        && !cont.deferredResumeEventId
        && cont.updatedAt < orphanCutoff;

      if (!jobTerminal && !leaseStale && !waitingStale) {
        continue;
      }

      await ctx.db.delete(cont._id);
      orphansCleaned++;
    }

    if (orphansCleaned > 0) {
      console.log(`Cleaned ${orphansCleaned} orphaned generation continuations`);
    }
  },
});
