import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { GenerationContinuationCheckpoint } from "../chat/generation_continuation_shared";
import type { RunGenerationParticipantArgs } from "../chat/generation_continuation_shared";
import {
  MAX_PRESENTATION_WORKFLOW_MODEL_PHASES,
  PRESENTATION_WORKFLOW_LEASE_MS,
} from "./limits";
import {
  expireDeferredPresentationRef,
  runDeferredPresentationPlanRef,
} from "./deferred_workflow_refs";

const DEFERRED_PRESENTATION_TIMEOUT_MS =
  PRESENTATION_WORKFLOW_LEASE_MS * MAX_PRESENTATION_WORKFLOW_MODEL_PHASES +
  2 * 60 * 1_000;

export async function scheduleDeferredPresentationWorkflow(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
  checkpoint: GenerationContinuationCheckpoint,
  workflow: {
    projectId: Id<"presentationProjects">;
    toolCallId: string;
  },
): Promise<void> {
  await ctx.runMutation(internal.chat.mutations.saveGenerationContinuation, {
    chatId: args.chatId,
    messageId: args.participant.messageId,
    jobId: args.participant.jobId,
    userId: args.userId,
    checkpoint,
  });

  const phaseArgs = {
    projectId: workflow.projectId,
    userId: args.userId,
    jobId: args.participant.jobId,
    toolCallId: workflow.toolCallId,
    modelId: args.participant.modelId,
    requireZdrOverride: args.requireZdrOverride,
  };
  const scheduledFunctionId = await ctx.scheduler.runAfter(
    0,
    runDeferredPresentationPlanRef,
    phaseArgs,
  );
  await ctx.runMutation(internal.chat.mutations.setGenerationContinuationScheduled, {
    jobId: args.participant.jobId,
    scheduledFunctionId,
  });
  await ctx.scheduler.runAfter(
    DEFERRED_PRESENTATION_TIMEOUT_MS,
    expireDeferredPresentationRef,
    phaseArgs,
  );
}
