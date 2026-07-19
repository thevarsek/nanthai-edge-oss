import type { WorkflowId } from "@convex-dev/workflow";
import type { MutationCtx } from "../_generated/server";
import { durableWorkflow } from "./components";

type ScheduleRetry = () => Promise<void>;

function isMissingWorkflow(error: unknown): boolean {
  return error instanceof Error && /Workflow(?: .*?)? not found/i.test(error.message);
}

export async function cleanupDurableWorkflow(
  ctx: MutationCtx,
  workflowId: string,
  scheduleRetry: ScheduleRetry,
): Promise<boolean> {
  let status;
  try {
    status = await durableWorkflow.status(ctx, workflowId as WorkflowId);
  } catch (error) {
    if (isMissingWorkflow(error)) return true;
    await scheduleRetry();
    return false;
  }
  if (status.type === "inProgress") {
    await scheduleRetry();
    return false;
  }
  try {
    // A terminal Workflow can disappear between status and cleanup. Both a
    // successful delete and an already-missing row are settled outcomes.
    await durableWorkflow.cleanup(ctx, workflowId as WorkflowId);
    return true;
  } catch (error) {
    if (isMissingWorkflow(error)) return true;
    await scheduleRetry();
    return false;
  }
}
