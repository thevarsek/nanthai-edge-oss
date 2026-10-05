import { v } from "convex/values";
import { internal } from "../_generated/api";
import { durableWorkflow } from "../execution/components";
import { generationParticipantWorkflowArgs } from "../chat/workflow_contract";
import { runGenerationParticipantWorkflowHandler } from "../chat/generation_workflow";

export const run = durableWorkflow.define({
  args: generationParticipantWorkflowArgs, returns: v.null(),
  handler: async (step, args): Promise<null> => {
    await step.runMutation(internal.autonomous.local_turns.bindWorkflow, { jobId: args.participant.jobId, workflowId: step.workflowId });
    await runGenerationParticipantWorkflowHandler(step, args);
    return null;
  },
});
