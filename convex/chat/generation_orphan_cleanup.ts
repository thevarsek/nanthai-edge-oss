import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { terminalizeAttempt } from "../execution/attempts";

const BATCH_SIZE = 20;
const ACTIVE_DRIVE_STATUSES = ["awaiting_pick", "resuming"] as const;
// Started analytics/presentation children own their lifecycle and may be in
// the signal->finish window while the parent terminalizes. This repair only
// claims rows that never crossed the durable handoff boundary.
const ACTIVE_ANALYTICS_STATUSES = ["prepared"] as const;
const ACTIVE_PRESENTATION_STATUSES = [
  "draft",
  "planning",
] as const;

async function closeDriveBatches(
  ctx: MutationCtx,
  job: Doc<"generationJobs">,
): Promise<boolean> {
  let saturated = false;
  const targetStatus = job.status === "cancelled"
    ? "cancelled"
    : job.status === "completed" ? "completed" : "failed";
  for (const status of ACTIVE_DRIVE_STATUSES) {
    const batches = await ctx.db.query("drivePickerBatches")
      .withIndex("by_parent_job_status", (q) => q
        .eq("parentJobId", job._id)
        .eq("status", status))
      .take(BATCH_SIZE);
    saturated ||= batches.length === BATCH_SIZE;
    for (const batch of batches) {
      await ctx.db.patch(batch._id, { status: targetStatus, updatedAt: Date.now() });
      const message = await ctx.db.get(batch.parentMessageId);
      if (message?.drivePickerBatchId === batch._id) {
        await ctx.db.patch(message._id, { drivePickerBatchId: undefined });
      }
    }
  }
  return saturated;
}

async function terminalizeCurrentAnalyticsAttempt(
  ctx: MutationCtx,
  analytics: Doc<"analyticsWorkflowRuns">,
  outcome: "failed" | "cancelled",
): Promise<void> {
  const run = await ctx.db.get(analytics.executionRunId);
  const attempt = run?.activeAttemptId ? await ctx.db.get(run.activeAttemptId) : null;
  if (
    run
    && attempt
    && !["completed", "failed", "cancelled"].includes(run.state)
    && !["completed", "failed", "cancelled", "superseded"].includes(attempt.status)
  ) {
    await terminalizeAttempt(ctx, {
      attemptId: attempt._id,
      fence: attempt.fence,
      outcome,
      summary: outcome === "cancelled"
        ? "Parent generation cancelled before analytics handoff"
        : "Parent generation terminated before analytics handoff",
      allowExpiredLease: true,
      allowWaiting: true,
    });
  }
}

async function closeAnalyticsRuns(
  ctx: MutationCtx,
  job: Doc<"generationJobs">,
): Promise<boolean> {
  let saturated = false;
  for (const status of ACTIVE_ANALYTICS_STATUSES) {
    const runs = await ctx.db.query("analyticsWorkflowRuns")
      .withIndex("by_job_status", (q) => q.eq("jobId", job._id).eq("status", status))
      .take(BATCH_SIZE);
    saturated ||= runs.length === BATCH_SIZE;
    for (const run of runs) {
      if (run.workflowId) continue;
      const outcome = job.status === "cancelled" ? "cancelled" : "failed";
      await terminalizeCurrentAnalyticsAttempt(ctx, run, outcome);
      const now = Date.now();
      await ctx.db.patch(run._id, {
        status: outcome,
        phase: outcome,
        error: outcome === "failed"
          ? "Parent generation terminated before analytics handoff"
          : undefined,
        completedAt: now,
        updatedAt: now,
      });
    }
  }
  return saturated;
}

export async function reconcileGenerationOwnedChildrenHandler(
  ctx: MutationCtx,
  args: { jobId: Id<"generationJobs"> },
): Promise<number> {
  const job = await ctx.db.get(args.jobId);
  if (!job || !["completed", "failed", "cancelled", "timedOut"].includes(job.status)) return 0;
  const more = await closeDriveBatches(ctx, job)
    || await closeAnalyticsRuns(ctx, job);
  if (more) {
    await ctx.scheduler.runAfter(
      0,
      internal.chat.generation_orphan_cleanup.reconcileGenerationOwnedChildren,
      args,
    );
  }
  return more ? 1 : 0;
}

export async function reconcileGenerationOwnedPresentationsHandler(
  ctx: MutationCtx,
  args: { assistantMessageId: Id<"messages"> },
): Promise<number> {
  let saturated = false;
  for (const status of ACTIVE_PRESENTATION_STATUSES) {
    const projects = await ctx.db.query("presentationProjects")
      .withIndex("by_origin_assistant_status", (q) => q
        .eq("originAssistantMessageId", args.assistantMessageId)
        .eq("status", status))
      .take(BATCH_SIZE);
    saturated ||= projects.length === BATCH_SIZE;
    for (const project of projects) {
      if (project.workflowId) continue;
      await ctx.db.patch(project._id, {
        status: "failed",
        workflowPhase: "failed",
        error: "Parent generation terminated before presentation handoff",
        updatedAt: Date.now(),
      });
    }
  }
  if (saturated) {
    await ctx.scheduler.runAfter(
      0,
      internal.chat.generation_orphan_cleanup.reconcileGenerationOwnedPresentations,
      args,
    );
  }
  return saturated ? 1 : 0;
}

export const reconcileGenerationOwnedChildren = internalMutation({
  args: { jobId: v.id("generationJobs") },
  returns: v.number(),
  handler: reconcileGenerationOwnedChildrenHandler,
});

export const reconcileGenerationOwnedPresentations = internalMutation({
  args: { assistantMessageId: v.id("messages") },
  returns: v.number(),
  handler: reconcileGenerationOwnedPresentationsHandler,
});
