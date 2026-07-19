import { v } from "convex/values";
import type { EventId } from "@convex-dev/workflow";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { durableWorkflow } from "../execution/components";
import { reconcileGenerationDeferredOwnership } from "./generation_deferred_ownership";
import {
  generationResumeEventValue,
  isIgnorableResumeSignalError,
} from "./workflow_resume_handlers";

const TERMINAL_GENERATION_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timedOut",
]);

const rebindDeferredResumeArgs = {
    jobId: v.id("generationJobs"),
    userId: v.string(),
    oldEventId: v.string(),
    newEventId: v.string(),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
};

type RebindDeferredResumeDeps = {
  sendResumeEvent: (
    ctx: MutationCtx,
    eventId: string,
    batchId: Id<"drivePickerBatches">,
  ) => Promise<void>;
};

const defaultRebindDeps: RebindDeferredResumeDeps = {
  sendResumeEvent: async (ctx, eventId, batchId) => {
    await durableWorkflow.sendEvent(ctx, {
      id: eventId as EventId<string>,
      validator: generationResumeEventValue,
      value: { mode: "fresh", drivePickerBatchId: String(batchId) },
    }).catch((error: unknown) => {
      if (!isIgnorableResumeSignalError(error)) throw error;
    });
  },
};

export async function rebindDeferredResumeHandler(
  ctx: MutationCtx,
  args: {
    jobId: Id<"generationJobs">;
    userId: string;
    oldEventId: string;
    newEventId: string;
    executionAttemptId?: Id<"executionAttempts">;
    executionFence?: number;
  },
  deps: RebindDeferredResumeDeps = defaultRebindDeps,
): Promise<boolean> {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== args.userId || TERMINAL_GENERATION_STATUSES.has(job.status)) {
      return false;
    }
    const continuation = await ctx.db
      .query("generationContinuations")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .first();
    if (!continuation || continuation.deferredResumeEventId !== args.oldEventId) {
      return false;
    }
    // Capture legacy and owned Drive batches before ownership reconciliation
    // rebinds their event IDs. A picker may already have reached `resuming`.
    const driveBatches = await ctx.db
      .query("drivePickerBatches")
      .withIndex("by_parent_job_resume_event", (q) => q
        .eq("parentJobId", args.jobId)
        .eq("workflowResumeEventId", args.oldEventId))
      .collect();
    const now = Date.now();
    await ctx.db.patch(continuation._id, {
      deferredResumeEventId: args.newEventId,
      executionAttemptId: args.executionAttemptId ?? continuation.executionAttemptId,
      executionFence: args.executionFence ?? continuation.executionFence,
      updatedAt: now,
    });
    if (continuation.deferredOwnership) {
      await reconcileGenerationDeferredOwnership(ctx, {
        ownership: continuation.deferredOwnership,
        eventId: args.newEventId,
        jobId: args.jobId,
        userId: args.userId,
        executionAttemptId: args.executionAttemptId,
        executionFence: args.executionFence,
      });
    }
    const analyticsRun = await ctx.db
      .query("analyticsWorkflowRuns")
      .withIndex("by_parent_event", (q) => q.eq("parentEventId", args.oldEventId))
      .unique();
    if (analyticsRun) {
      await ctx.db.patch(analyticsRun._id, {
        parentEventId: args.newEventId,
        updatedAt: now,
      });
    }
    const project = await ctx.db
      .query("presentationProjects")
      .withIndex("by_parent_resume_event", (q) =>
        q.eq("parentResumeEventId", args.oldEventId)
      )
      .unique();
    if (project) {
      await ctx.db.patch(project._id, {
        parentResumeEventId: args.newEventId,
        updatedAt: now,
      });
    }
    const subagentBatches = await ctx.db
      .query("subagentBatches")
      .withIndex("by_parent_job_resume_event", (q) => q
        .eq("parentJobId", args.jobId)
        .eq("workflowResumeEventId", args.oldEventId))
      .collect();
    for (const subagentBatch of subagentBatches) {
      const params = subagentBatch.paramsSnapshot as Record<string, unknown> | null;
      if (params?.workflowResumeEventId === args.oldEventId) {
        await ctx.db.patch(subagentBatch._id, {
          paramsSnapshot: {
            ...params,
            workflowResumeEventId: args.newEventId,
            executionAttemptId: args.executionAttemptId ?? params.executionAttemptId,
            executionFence: args.executionFence ?? params.executionFence,
          },
          workflowResumeEventId: args.newEventId,
          updatedAt: now,
        });
      }
    }
    for (const driveBatch of driveBatches) {
      const params = driveBatch.paramsSnapshot as Record<string, unknown> | null;
      if (params?.workflowResumeEventId === args.oldEventId) {
        await ctx.db.patch(driveBatch._id, {
          paramsSnapshot: {
            ...params,
            workflowResumeEventId: args.newEventId,
            executionAttemptId: args.executionAttemptId ?? params.executionAttemptId,
            executionFence: args.executionFence ?? params.executionFence,
          },
          workflowResumeEventId: args.newEventId,
          updatedAt: now,
        });
      }
      if (driveBatch.status === "resuming") {
        await deps.sendResumeEvent(ctx, args.newEventId, driveBatch._id);
      }
    }
    return true;
}

export const rebindDeferredResume = internalMutation({
  args: rebindDeferredResumeArgs,
  returns: v.boolean(),
  handler: rebindDeferredResumeHandler,
});
