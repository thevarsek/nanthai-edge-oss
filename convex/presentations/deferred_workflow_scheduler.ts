import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { GenerationContinuationCheckpoint } from "../chat/generation_continuation_shared";
import type { RunGenerationParticipantArgs } from "../chat/generation_continuation_shared";
import { scheduleGenerationContinuation } from "../chat/actions_run_generation_continuation";
import { startPresentationWorkflowRef } from "./presentation_workflow_refs";

export async function scheduleDeferredPresentationWorkflow(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
  checkpoint: GenerationContinuationCheckpoint,
  workflow: {
    projectId: Id<"presentationProjects">;
    toolCallId: string;
  },
): Promise<void> {
  if (!args.workflowResumeEventId) {
    throw new Error("PRESENTATION_PARENT_WORKFLOW_EVENT_REQUIRED");
  }
  await scheduleGenerationContinuation(
    ctx,
    { ...args, workflowManaged: true },
    {
      ...checkpoint,
      deferredResumeEventId: args.workflowResumeEventId,
      deferredOwnership: {
        kind: "presentation",
        projectId: workflow.projectId,
        toolCallId: workflow.toolCallId,
        modelId: args.participant.modelId,
        ...(args.requireZdrOverride !== undefined
          ? { requireZdrOverride: args.requireZdrOverride }
          : {}),
      },
    },
  );

  const phaseArgs = {
    projectId: workflow.projectId,
    userId: args.userId,
    jobId: args.participant.jobId,
    toolCallId: workflow.toolCallId,
    modelId: args.participant.modelId,
    ...(args.requireZdrOverride !== undefined
      ? { requireZdrOverride: args.requireZdrOverride }
      : {}),
    workflowResumeEventId: args.workflowResumeEventId,
  };
  await ctx.runMutation(startPresentationWorkflowRef, phaseArgs);
}
