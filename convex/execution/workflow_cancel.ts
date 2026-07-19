import type { WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { durableWorkflow } from "./components";

export const cancelWorkflow = internalMutation({
  args: { workflowId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await durableWorkflow
      .cancel(ctx, args.workflowId as WorkflowId)
      .catch(() => undefined);
    return null;
  },
});
