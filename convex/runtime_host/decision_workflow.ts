import type { WorkflowCtx } from "@convex-dev/workflow";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

type LocalDecisionArgs = {
  parentAttemptId: Id<"executionAttempts">; parentFence: number;
  chatId: Id<"chats">; sourceMessageId: Id<"messages">; requestKey: string;
  participantIds: Id<"chatParticipants">[]; messages: Array<{ role: string; content: string }>;
};

export async function runLocalDecisionOutcome(step: WorkflowCtx, args: LocalDecisionArgs) {
  const taskId = await step.runMutation(internal.runtime_host.decision_helpers.start, args);
  if (!taskId) return { kind: "unavailable" as const };
  // The Workflow journal owns this wait; the helper has its own child run,
  // attempt and component, so Stop tears down both without action polling.
  await step.runWorkflow(internal.runtime_host.decision_helper_workflow.run, { taskId });
  const context = await step.runQuery(internal.runtime_host.helper_tasks.get, { taskId });
  return context?.task.status === "completed"
    ? { kind: "completed" as const, content: context.task.content } : { kind: "failed" as const };
}

export async function runLocalDecisionHelper(step: WorkflowCtx, args: LocalDecisionArgs): Promise<string | null> {
  const result = await runLocalDecisionOutcome(step, args);
  return result.kind === "completed" ? result.content : null;
}
