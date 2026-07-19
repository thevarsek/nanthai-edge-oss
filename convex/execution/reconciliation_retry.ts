import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

export const run = internalAction({
  args: {
    target: v.union(
      v.literal("generation_workflow"),
      v.literal("generation_dispatch"),
      v.literal("subagent_workflow"),
      v.literal("owned_workflow"),
      v.literal("advisor_synthesis"),
    ),
    payload: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (args.target === "generation_workflow") {
      await ctx.runMutation(
        internal.chat.workflow_events.reconcileGenerationWorkflowCompletion,
        args.payload,
      );
    } else if (args.target === "generation_dispatch") {
      await ctx.runMutation(
        internal.chat.generation_dispatch_workflow.reconcileGenerationDispatch,
        args.payload,
      );
    } else if (args.target === "subagent_workflow") {
      await ctx.runMutation(
        internal.subagents.workflow_lifecycle.reconcileSubagentWorkflow,
        args.payload,
      );
    } else if (args.target === "owned_workflow") {
      await ctx.runMutation(
        internal.execution.workflow_lifecycle.reconcileOwnedWorkflow,
        args.payload,
      );
    } else {
      await ctx.runMutation(
        internal.advisors.workflow_steps.reconcileAdvisorSynthesisWorkflow,
        args.payload,
      );
    }
    return null;
  },
});
