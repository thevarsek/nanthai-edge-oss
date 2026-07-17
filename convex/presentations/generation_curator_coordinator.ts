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
  getPresentationCuratorContextRef,
  startPresentationCuratorTasksRef,
  type PresentationCuratorContext,
} from "./generation_fanout_refs";
import { presentationGenerationJobIsActive } from "./generation_workflow_active";
import { safePresentationErrorMessage } from "./limits";

const runArgs = { runId: v.id("presentationGenerationRuns") };

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
    error: safePresentationErrorMessage(error),
  });
  if (changed) await failAndResume(ctx, workflowArgs(context), error);
}

export const runPresentationCurator = internalAction({
  args: runArgs,
  handler: async (ctx, args): Promise<void> => {
    const context = await ctx.runQuery(getPresentationCuratorContextRef, args);
    if (!context || !(await presentationGenerationJobIsActive(ctx, context.run.jobId))) return;
    try {
      if (!(await ctx.runMutation(claimPresentationCuratorRef, args))) return;
      const tasks = analyzePresentationCandidates(context.candidates);
      await ctx.runMutation(startPresentationCuratorTasksRef, { ...args, tasks });
    } catch (error) {
      await failRun(ctx, context, error);
    }
  },
});

export const runPresentationFinalizer = internalAction({
  args: runArgs,
  handler: async (ctx, args): Promise<void> => {
    const context = await ctx.runQuery(getPresentationCuratorContextRef, args);
    if (!context || !(await presentationGenerationJobIsActive(ctx, context.run.jobId))) return;
    try {
      await ctx.runMutation(finalizePresentationFanoutRef, args);
    } catch (error) {
      await failRun(ctx, context, error);
    }
  },
});
