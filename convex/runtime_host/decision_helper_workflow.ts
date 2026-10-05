import { v } from "convex/values";
import { internal } from "../_generated/api";
import { durableWorkflow } from "../execution/components";
import { runHelperWorkflowHandler } from "./helper_workflow";

// Separate registration preserves the journal of existing memory/title helpers.
export const run = durableWorkflow.define({
  args: { taskId: v.id("runtimeHelperTasks") }, returns: v.null(),
  handler: async (step, args): Promise<null> => {
    await step.runMutation(internal.runtime_host.decision_helpers.bindWorkflow, { taskId: args.taskId, workflowId: step.workflowId });
    return await runHelperWorkflowHandler(step, args);
  },
});
