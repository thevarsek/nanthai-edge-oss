import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { cleanupDurableWorkflow } from "./workflow_cleanup";

const cleanupOwnedWorkflowRef = makeFunctionReference<"mutation">(
  "execution/owned_workflow_cleanup:cleanupOwnedWorkflow",
);

export const cleanupOwnedWorkflow = internalMutation({
  args: { workflowId: v.string(), attempt: v.optional(v.number()) },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const attempt = args.attempt ?? 0;
    return await cleanupDurableWorkflow(ctx, args.workflowId, async () => {
      if (attempt < 12) {
        await ctx.scheduler.runAfter(5 * 60 * 1_000, cleanupOwnedWorkflowRef, {
          workflowId: args.workflowId,
          attempt: attempt + 1,
        });
      }
    });
  },
});
