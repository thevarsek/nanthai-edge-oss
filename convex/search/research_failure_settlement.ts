import type { WorkflowCtx } from "@convex-dev/workflow";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

export type ResearchFailureDisposition =
  | "failed"
  | "cancelled"
  | "completed"
  | "handed_off";

export async function settleResearchFailureDisposition(
  step: Pick<WorkflowCtx, "runMutation">,
  args: {
    sessionId: Id<"searchSessions">;
    executionAttemptId?: Id<"executionAttempts">;
    executionFence?: number;
  },
  disposition: ResearchFailureDisposition,
  summary: string,
  labels: {
    handedOff: string;
    alreadyCompleted: string;
    cancelled: string;
  },
): Promise<boolean> {
  if (disposition === "handed_off") {
    await step.runMutation(
      internal.search.execution_lifecycle.terminalizeResearchExecution,
      {
        ...args,
        outcome: "completed",
        summary: labels.handedOff,
      },
    );
    return true;
  }
  if (disposition === "completed" || disposition === "cancelled") {
    await step.runMutation(
      internal.search.execution_lifecycle.terminalizeResearchExecution,
      {
        ...args,
        outcome: disposition,
        summary: disposition === "completed"
          ? labels.alreadyCompleted
          : labels.cancelled,
      },
    );
    return true;
  }
  await step.runMutation(
    internal.search.execution_lifecycle.terminalizeResearchFailure,
    { ...args, summary },
  );
  return false;
}
