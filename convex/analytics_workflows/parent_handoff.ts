import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type {
  GenerationContinuationCheckpoint,
  RunGenerationParticipantArgs,
} from "../chat/generation_continuation_shared";
import { scheduleGenerationContinuation } from "../chat/actions_run_generation_continuation";
import { internal } from "../_generated/api";

export async function scheduleDeferredAnalyticsWorkflow(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
  checkpoint: GenerationContinuationCheckpoint,
  analyticsRunId: Id<"analyticsWorkflowRuns">,
): Promise<void> {
  if (!args.workflowResumeEventId) {
    throw new Error("ANALYTICS_WORKFLOW_EVENT_REQUIRED");
  }
  await scheduleGenerationContinuation(
    ctx,
    { ...args, workflowManaged: true },
    {
      ...checkpoint,
      deferredResumeEventId: args.workflowResumeEventId,
      deferredOwnership: { kind: "analytics", analyticsRunId },
    },
  );
  await ctx.runMutation(internal.analytics_workflows.mutations.startRun, {
    analyticsRunId,
    eventId: args.workflowResumeEventId,
  });
}
