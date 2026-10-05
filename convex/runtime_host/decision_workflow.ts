import type { WorkflowCtx } from "@convex-dev/workflow";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

export async function runLocalDecisionHelper(step: WorkflowCtx, args: {
  parentAttemptId: Id<"executionAttempts">; parentFence: number;
  chatId: Id<"chats">; sourceMessageId: Id<"messages">; requestKey: string;
  participantIds: Id<"chatParticipants">[]; messages: Array<{ role: string; content: string }>;
}): Promise<string | null> {
  const taskId = await step.runMutation(internal.runtime_host.decision_helpers.start, args);
  if (!taskId) return null;
  // The Workflow journal owns this wait; the helper has its own child run,
  // attempt and component, so Stop tears down both without action polling.
  await step.runWorkflow(internal.runtime_host.decision_helper_workflow.run, { taskId });
  const context = await step.runQuery(internal.runtime_host.helper_tasks.get, { taskId });
  return context?.task.status === "completed" ? context.task.content : null;
}
