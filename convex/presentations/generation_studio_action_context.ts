import type { ActionCtx } from "../_generated/server";
import type { DeferredPresentationWorkflowArgs } from "./deferred_workflow_refs";
import {
  getPresentationStudioContextRef,
  type PresentationStudioContext,
  type StudioActionArgs,
} from "./generation_fanout_refs";
import { resolvePresentationActionContext } from "./legacy_action_identity";

export async function presentationStudioActionContext(
  ctx: ActionCtx,
  args: StudioActionArgs,
): Promise<PresentationStudioContext | null> {
  return await resolvePresentationActionContext(
    ctx,
    args,
    async () => await ctx.runQuery(getPresentationStudioContextRef, args),
  );
}

export function presentationStudioWorkflowArgs(
  context: PresentationStudioContext,
): DeferredPresentationWorkflowArgs {
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
