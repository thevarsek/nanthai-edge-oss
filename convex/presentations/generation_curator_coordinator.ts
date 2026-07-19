"use node";

import { internalAction, type ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import { analyzePresentationCandidates } from "./curation_analysis";
import { failAndResume } from "./deferred_workflow_resume";
import type { DeferredPresentationWorkflowArgs } from "./deferred_workflow_refs";
import {
  claimPresentationCuratorRef,
  failPresentationFanoutRef,
  finalizePresentationFanoutRef,
  startPresentationCuratorTasksRef,
  type PresentationCuratorContext,
} from "./generation_fanout_refs";
import { presentationGenerationJobIsActive } from "./generation_workflow_active";
import { safePresentationErrorMessage } from "./limits";
import { presentationExecutionIdentity } from "./generation_execution_identity";
import {
  cancelUnfencedPresentationAction,
} from "./legacy_action_identity";
import { presentationCuratorActionContext as curatorContext } from
  "./generation_curator_action_context";

const runArgs = {
  runId: v.id("presentationGenerationRuns"),
  executionAttemptId: v.optional(v.id("executionAttempts")),
  executionFence: v.optional(v.number()),
};

function workflowArgs(context: PresentationCuratorContext): DeferredPresentationWorkflowArgs {
  return {
    projectId: context.project._id,
    userId: context.run.userId,
    jobId: context.run.jobId,
    toolCallId: context.run.toolCallId,
    modelId: context.run.selectedModelId,
    ...(context.run.requireZdrOverride !== undefined
      ? { requireZdrOverride: context.run.requireZdrOverride }
      : {}),
  };
}

async function failRun(
  ctx: ActionCtx,
  context: PresentationCuratorContext,
  error: unknown,
): Promise<void> {
  const changed = await ctx.runMutation(failPresentationFanoutRef, {
    runId: context.run._id,
    ...presentationExecutionIdentity(context.run),
    error: safePresentationErrorMessage(error),
  });
  if (changed && !context.project.workflowId) {
    await failAndResume(ctx, workflowArgs(context), error);
  }
}

export const runPresentationCurator = internalAction({
  args: runArgs,
  handler: async (ctx, args): Promise<void> => {
    const context = await curatorContext(ctx, args);
    if (!context) return;
    if (!(await presentationGenerationJobIsActive(ctx, context.run.jobId))) {
      await cancelUnfencedPresentationAction(ctx, args, context.run);
      return;
    }
    const executionIdentity = presentationExecutionIdentity(context.run);
    try {
      if (!(await ctx.runMutation(claimPresentationCuratorRef, {
        runId: context.run._id,
        ...executionIdentity,
      }))) return;
      const tasks = analyzePresentationCandidates(context.candidates);
      await ctx.runMutation(startPresentationCuratorTasksRef, {
        runId: context.run._id,
        ...executionIdentity,
        tasks,
      });
    } catch (error) {
      await failRun(ctx, context, error);
    }
  },
});

export const runPresentationFinalizer = internalAction({
  args: runArgs,
  handler: async (ctx, args): Promise<void> => {
    const context = await curatorContext(ctx, args);
    if (!context) return;
    if (!(await presentationGenerationJobIsActive(ctx, context.run.jobId))) {
      await cancelUnfencedPresentationAction(ctx, args, context.run);
      return;
    }
    try {
      await ctx.runMutation(finalizePresentationFanoutRef, {
        runId: context.run._id,
        ...presentationExecutionIdentity(context.run),
      });
    } catch (error) {
      await failRun(ctx, context, error);
    }
  },
});
