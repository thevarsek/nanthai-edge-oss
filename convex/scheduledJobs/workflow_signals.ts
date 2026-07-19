import type { WorkflowId } from "@convex-dev/workflow";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { durableWorkflow } from "../execution/components";
import { scheduledStepEventName } from "./execution_workflow";

export async function notifyScheduledStepTerminal(
  ctx: MutationCtx,
  args: {
    jobId: Id<"scheduledJobs">;
    executionId: string;
    stepIndex: number;
    assistantMessageId: Id<"messages">;
    status: "completed" | "failed" | "cancelled";
    error?: string;
  },
): Promise<void> {
  const job = await ctx.db.get(args.jobId);
  if (
    !job?.activeWorkflowId ||
    job.activeExecutionId !== args.executionId ||
    job.activeStepIndex !== args.stepIndex
  ) return;
  await durableWorkflow.sendEvent(ctx, {
    workflowId: job.activeWorkflowId as WorkflowId,
    name: scheduledStepEventName(args.stepIndex),
    value: {
      status: args.status,
      assistantMessageId: args.assistantMessageId,
      error: args.error,
    },
  });
}
