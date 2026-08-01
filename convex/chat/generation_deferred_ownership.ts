import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { startAnalyticsRunHandler } from "../analytics_workflows/mutations";
import { enqueueSubagentHandler } from "../execution/fanout_queues";
import { startPresentationWorkflowHandler } from "../presentations/presentation_workflow_start";
import type { GenerationDeferredOwnership } from "./generation_continuation_shared";

type ReconcileArgs = {
  ownership: GenerationDeferredOwnership;
  eventId: string;
  jobId: Id<"generationJobs">;
  userId: string;
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
};

type ReconcileDeps = {
  enqueueSubagent: typeof enqueueSubagentHandler;
  startPresentation: typeof startPresentationWorkflowHandler;
  startAnalytics: typeof startAnalyticsRunHandler;
};

const defaultDeps: ReconcileDeps = {
  enqueueSubagent: enqueueSubagentHandler,
  startPresentation: startPresentationWorkflowHandler,
  startAnalytics: startAnalyticsRunHandler,
};

export async function reconcileGenerationDeferredOwnership(
  ctx: MutationCtx,
  args: ReconcileArgs,
  deps: ReconcileDeps = defaultDeps,
): Promise<void> {
  const ownership = args.ownership;
  if (ownership.kind === "subagents") {
    const batch = await ctx.db.get(ownership.batchId);
    if (!batch || batch.parentJobId !== args.jobId || batch.userId !== args.userId) {
      throw new Error("GENERATION_SUBAGENT_OWNERSHIP_MISMATCH");
    }
    const params = batch.paramsSnapshot as Record<string, unknown>;
    if (batch.workflowResumeEventId !== args.eventId) {
      await ctx.db.patch(batch._id, {
        workflowResumeEventId: args.eventId,
        paramsSnapshot: {
          ...params,
          workflowResumeEventId: args.eventId,
          executionAttemptId: args.executionAttemptId ?? params.executionAttemptId,
          executionFence: args.executionFence ?? params.executionFence,
        },
        updatedAt: Date.now(),
      });
    }
    const runs = await ctx.db
      .query("subagentRuns")
      .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
      .collect();
    for (const run of runs) {
      if (run.status === "queued" && !run.workpoolOperationId) {
        await deps.enqueueSubagent(ctx, { runId: run._id });
      }
    }
    return;
  }

  if (ownership.kind === "presentation") {
    const project = await ctx.db.get(ownership.projectId);
    if (!project || project.userId !== args.userId) {
      throw new Error("GENERATION_PRESENTATION_OWNERSHIP_MISMATCH");
    }
    if (project.workflowId) {
      if (project.parentResumeEventId !== args.eventId) {
        await ctx.db.patch(project._id, {
          parentResumeEventId: args.eventId,
          updatedAt: Date.now(),
        });
      }
      return;
    }
    await deps.startPresentation(ctx, {
      projectId: ownership.projectId,
      userId: args.userId,
      jobId: args.jobId,
      toolCallId: ownership.toolCallId,
      modelId: ownership.modelId,
      requireZdrOverride: ownership.requireZdrOverride,
      workflowResumeEventId: args.eventId,
    });
    return;
  }

  if (ownership.kind === "drive_picker") {
    const batch = await ctx.db.get(ownership.batchId);
    if (!batch || batch.parentJobId !== args.jobId || batch.userId !== args.userId) {
      throw new Error("GENERATION_DRIVE_PICKER_OWNERSHIP_MISMATCH");
    }
    const params = batch.paramsSnapshot as Record<string, unknown>;
    if (batch.workflowResumeEventId !== args.eventId) {
      await ctx.db.patch(batch._id, {
        workflowResumeEventId: args.eventId,
        paramsSnapshot: {
          ...params,
          workflowResumeEventId: args.eventId,
          executionAttemptId: args.executionAttemptId ?? params.executionAttemptId,
          executionFence: args.executionFence ?? params.executionFence,
        },
        updatedAt: Date.now(),
      });
    }
    return;
  }

  if (ownership.kind === "remote_mcp") {
    const invocation = await ctx.db.get(ownership.invocationId);
    if (
      !invocation
      || invocation.userId !== args.userId
      || invocation.generationJobId !== args.jobId
      || invocation.toolCallId !== ownership.toolCallId
    ) {
      throw new Error("GENERATION_REMOTE_MCP_OWNERSHIP_MISMATCH");
    }
    if (invocation.parentResumeEventId !== args.eventId) {
      await ctx.db.patch(invocation._id, {
        parentResumeEventId: args.eventId,
        updatedAt: Date.now(),
      });
    }
    return;
  }

  const run = await ctx.db.get(ownership.analyticsRunId);
  if (!run || run.jobId !== args.jobId || run.userId !== args.userId) {
    throw new Error("GENERATION_ANALYTICS_OWNERSHIP_MISMATCH");
  }
  if (run.workflowId) {
    if (run.parentEventId !== args.eventId) {
      await ctx.db.patch(run._id, { parentEventId: args.eventId, updatedAt: Date.now() });
    }
    return;
  }
  await deps.startAnalytics(ctx, {
    analyticsRunId: ownership.analyticsRunId,
    eventId: args.eventId,
  });
}
