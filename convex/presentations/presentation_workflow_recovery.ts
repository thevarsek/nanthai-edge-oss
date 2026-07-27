import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { claimExecutionRun } from "../execution/attempts";
import { linkExecutionComponent } from "../execution/component_refs";
import { durableWorkflow } from "../execution/components";
import { ownedWorkflowCompletionRef } from "../execution/workflow_lifecycle";
import { scheduleOwnedWorkflowWatchdog } from
  "../execution/owned_workflow_watchdog";
import { cancelWorkflowIfRunning } from "../execution/workflow_cancel";

export async function recoverPresentationWorkflowHandler(
  ctx: MutationCtx,
  args: {
    runId: Id<"presentationGenerationRuns">;
    expectedAttemptId: Id<"executionAttempts">;
    expectedFence: number;
  },
  deps: {
    claim: typeof claimExecutionRun;
    start: (ctx: MutationCtx, args: Record<string, unknown>) => Promise<string>;
    link: typeof linkExecutionComponent;
    cancel: (ctx: MutationCtx, workflowId: string) => Promise<void>;
    scheduleWatchdog?: typeof scheduleOwnedWorkflowWatchdog;
  } = {
    claim: claimExecutionRun,
    start: async (startCtx, workflowArgs) => await durableWorkflow.start(
      startCtx,
      internal.presentations.presentation_workflow.runPresentationWorkflow,
      workflowArgs as never,
      { startAsync: true, onComplete: ownedWorkflowCompletionRef, context: {} },
    ),
    link: linkExecutionComponent,
    cancel: async (cancelCtx, workflowId) => {
      await cancelWorkflowIfRunning(cancelCtx, workflowId);
    },
    scheduleWatchdog: scheduleOwnedWorkflowWatchdog,
  },
): Promise<string | null> {
  const run = await ctx.db.get(args.runId);
  if (
    !run
    || run.status === "complete"
    || run.status === "failed"
    || run.executionAttemptId !== args.expectedAttemptId
    || run.executionFence !== args.expectedFence
    || !run.executionRunId
  ) return run?.workflowId ?? null;
  const project = await ctx.db.get(run.projectId);
  if (!project || project.status !== "generating" || project.userId !== run.userId) {
    return null;
  }
  if (!project.parentResumeEventId) {
    throw new Error("PRESENTATION_PARENT_WORKFLOW_EVENT_REQUIRED");
  }
  const claimantId = `presentation:${String(project._id)}`;
  const replacement = await deps.claim(ctx, {
    runId: run.executionRunId,
    claimantId,
    leaseMs: 30 * 60 * 1_000,
  });
  if (!replacement || replacement.attemptId === args.expectedAttemptId) return null;
  const workflowId = await deps.start(ctx, {
      projectId: project._id,
      userId: run.userId,
      jobId: run.jobId,
      toolCallId: run.toolCallId,
      modelId: run.selectedModelId,
      requireZdrOverride: run.requireZdrOverride,
      workflowResumeEventId: project.parentResumeEventId,
      executionAttemptId: replacement.attemptId,
      executionFence: replacement.fence,
  });
  await deps.link(ctx, {
    runId: replacement.runId,
    attemptId: replacement.attemptId,
    fence: replacement.fence,
    adapterId: "convex-workflow",
    operationId: workflowId,
    role: "presentation-workflow-recovery",
  });
  await deps.scheduleWatchdog?.(ctx, { workflowId, context: {} });
  const oldWorkflowId = project.workflowId ?? run.workflowId;
  const now = Date.now();
  await ctx.db.patch(project._id, {
    workflowId,
    executionAttemptId: replacement.attemptId,
    executionFence: replacement.fence,
    updatedAt: now,
  });
  await ctx.db.patch(run._id, {
    workflowId,
    executionAttemptId: replacement.attemptId,
    executionFence: replacement.fence,
    updatedAt: now,
  });
  if (oldWorkflowId && oldWorkflowId !== workflowId) {
    await deps.cancel(ctx, oldWorkflowId).catch(() => undefined);
  }
  return workflowId;
}

export const recoverPresentationWorkflow = internalMutation({
  args: {
    runId: v.id("presentationGenerationRuns"),
    expectedAttemptId: v.id("executionAttempts"),
    expectedFence: v.number(),
  },
  returns: v.union(v.string(), v.null()),
  handler: recoverPresentationWorkflowHandler,
});
