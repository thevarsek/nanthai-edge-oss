import type { WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { durableWorkflow } from "./components";

function isSettledWorkflowError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Workflow(?: .*?)? (?:not found|not running)/i.test(message);
}

/**
 * Cancel a legacy-owned workflow without issuing a known-to-fail component
 * mutation for a workflow that has already settled.
 *
 * New execution runs must use the run-tree teardown surface instead. This
 * helper exists only for legacy rows and resumable autonomous pauses that do
 * not terminalize their execution run.
 */
export async function cancelWorkflowIfRunning(
  ctx: Parameters<typeof durableWorkflow.cancel>[0],
  workflowId: string,
): Promise<boolean> {
  try {
    const status = await durableWorkflow.status(ctx, workflowId as WorkflowId);
    if (status.type !== "inProgress") return true;
    await durableWorkflow.cancel(ctx, workflowId as WorkflowId);
    return true;
  } catch (error) {
    return isSettledWorkflowError(error);
  }
}

export const cancelWorkflow = internalMutation({
  args: { workflowId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await cancelWorkflowIfRunning(ctx, args.workflowId);
    return null;
  },
});
