import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { durableWorkflow } from "../execution/components";
import { ensureGenerationExecution } from "../execution/control_plane";
import { claimExecutionRun } from "../execution/attempts";
import { linkExecutionComponent } from "../execution/component_refs";
import { createExecutionRun } from "../execution/runs";
import type { Id } from "../_generated/dataModel";
import { deferredWorkflowArgsValidator } from "./presentation_workflow_validators";
import { presentationWorkflowRef } from "./presentation_workflow_refs";
import type { DeferredPresentationWorkflowArgs } from "./deferred_workflow_refs";
import { ownedWorkflowCompletionRef } from "../execution/workflow_lifecycle";
import { scheduleOwnedWorkflowWatchdog } from
  "../execution/owned_workflow_watchdog";

type StartWorkflow = (
  ctx: MutationCtx,
  args: DeferredPresentationWorkflowArgs & {
    executionAttemptId: Id<"executionAttempts">;
    executionFence: number;
  },
) => Promise<string>;

type StartedExecution = {
  runId: Id<"executionRuns">;
  attemptId: Id<"executionAttempts">;
  fence: number;
};

type StartExecution = (
  ctx: MutationCtx,
  args: DeferredPresentationWorkflowArgs,
) => Promise<StartedExecution>;

type LinkWorkflow = (
  ctx: MutationCtx,
  execution: StartedExecution,
  workflowId: string,
) => Promise<void>;

type ClaimExecution = (
  ctx: MutationCtx,
  execution: StartedExecution,
  args: DeferredPresentationWorkflowArgs,
) => Promise<StartedExecution>;

const startWorkflow: StartWorkflow = async (ctx, args) => await durableWorkflow.start(
  ctx,
  presentationWorkflowRef,
  args,
  { startAsync: true, onComplete: ownedWorkflowCompletionRef, context: {} },
);

const startExecution: StartExecution = async (ctx, args) => {
  const parent = await ensureGenerationExecution(ctx, args.jobId);
  if (!parent) throw new Error("Presentation parent execution was unavailable.");
  const created = await createExecutionRun(ctx, {
    userId: args.userId,
    runKey: `presentation:${String(args.projectId)}`,
    kind: "presentation",
    requestedPlacement: "cloud",
    generationJobId: args.jobId,
    domainType: "presentation",
    domainId: String(args.projectId),
    parentRunId: parent.runId,
    initialAttempt: {
      executorKind: "convex_workflow",
      placement: "cloud",
      adapterId: "convex-workflow",
      provider: args.modelId.split("/")[0],
      modelId: args.modelId,
    },
  });
  return created;
};

const linkWorkflow: LinkWorkflow = async (ctx, execution, workflowId) => {
  await linkExecutionComponent(ctx, {
    runId: execution.runId,
    attemptId: execution.attemptId,
    fence: execution.fence,
    adapterId: "convex-workflow",
    operationId: workflowId,
    role: "presentation-workflow",
  });
  await scheduleOwnedWorkflowWatchdog(ctx, { workflowId, context: {} });
};

const claimExecution: ClaimExecution = async (ctx, execution, args) => {
  return await claimExecutionRun(ctx, {
    runId: execution.runId,
    claimantId: `presentation:${String(args.projectId)}`,
    leaseMs: 30 * 60 * 1_000,
  }) ?? execution;
};

export async function startPresentationWorkflowHandler(
  ctx: MutationCtx,
  args: DeferredPresentationWorkflowArgs,
  start: StartWorkflow = startWorkflow,
  createExecution: StartExecution = startExecution,
  link: LinkWorkflow = linkWorkflow,
  claim: ClaimExecution = claimExecution,
): Promise<string> {
  const project = await ctx.db.get(args.projectId);
  if (!project || project.userId !== args.userId) {
    throw new Error("Presentation not found or unauthorized.");
  }
  if (project.workflowId) {
    return project.workflowId;
  }
  const execution = await createExecution(ctx, args);
  const activeExecution = await claim(ctx, execution, args);
  const workflowId = await start(ctx, {
    ...args,
    executionAttemptId: activeExecution.attemptId,
    executionFence: activeExecution.fence,
  });
  await link(ctx, activeExecution, workflowId);
  await ctx.db.patch(project._id, {
    workflowId,
    parentResumeEventId: args.workflowResumeEventId,
    executionRunId: activeExecution.runId,
    executionAttemptId: activeExecution.attemptId,
    executionFence: activeExecution.fence,
    updatedAt: Date.now(),
  });
  return workflowId;
}

export const startPresentationWorkflow = internalMutation({
  // Execution identity is created by this mutation, not supplied by callers.
  args: deferredWorkflowArgsValidator,
  returns: v.string(),
  handler: startPresentationWorkflowHandler,
});
