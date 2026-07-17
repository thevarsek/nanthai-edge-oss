"use node";

import { v } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import { getProjectInternalRef, markFailedRef } from "./action_refs";
import { createPresentationActionDepsForTest } from "./action_shared";
import { workflowDeps } from "./deferred_workflow_actions";
import { failAndResume } from "./deferred_workflow_resume";
import type { DeferredPresentationRepairArgs } from "./deferred_workflow_refs";
import { safePresentationErrorMessage } from "./limits";

export const deferredPresentationRepairArgs = {
  projectId: v.id("presentationProjects"),
  userId: v.string(),
  jobId: v.id("generationJobs"),
  toolCallId: v.string(),
  modelId: v.string(),
  requireZdrOverride: v.optional(v.boolean()),
  invalidResponse: v.string(),
  validationError: v.string(),
  candidateStorageId: v.optional(v.id("_storage")),
  targetSlideId: v.optional(v.string()),
  repairAttempt: v.optional(v.number()),
  priorEffectiveModelId: v.optional(v.string()),
};

export async function markPresentationFailedAndResume(
  ctx: ActionCtx,
  args: DeferredPresentationRepairArgs,
  error: unknown,
): Promise<void> {
  const project = await ctx.runQuery(getProjectInternalRef, {
    projectId: args.projectId,
    userId: args.userId,
  });
  if (!project || project.status === "failed" || project.status === "ready") {
    await failAndResume(ctx, args, error);
    return;
  }
  try {
    await ctx.runMutation(markFailedRef, {
      projectId: project._id,
      userId: args.userId,
      expectedRevision: project.revision,
      error: safePresentationErrorMessage(error),
    });
  } finally {
    await failAndResume(ctx, args, error);
  }
}

export function presentationRepairDeps(userId: string) {
  return createPresentationActionDepsForTest(workflowDeps(userId));
}
