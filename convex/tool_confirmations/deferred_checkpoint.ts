import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { GenerationContinuationCheckpoint } from "../chat/generation_continuation_shared";

/**
 * Install the generation checkpoint that waits on a tool confirmation. The
 * Workflow then awaits the same resume event; respond/expire deliver the
 * outcome through the shared deferred-tool completion path.
 */
export async function bindDeferredToolConfirmation(
  ctx: ActionCtx,
  args: {
    chatId: Id<"chats">;
    userId: string;
    messageId: Id<"messages">;
    jobId: Id<"generationJobs">;
    workflowResumeEventId?: string;
    executionAttemptId?: Id<"executionAttempts">;
    executionFence?: number;
  },
  checkpoint: GenerationContinuationCheckpoint,
  deferred: { confirmationId: string; toolCallId: string },
): Promise<void> {
  if (!args.workflowResumeEventId || !args.executionAttemptId || args.executionFence === undefined) {
    throw new Error("TOOL_CONFIRMATION_DURABLE_CHECKPOINT_REQUIRED");
  }
  const confirmationId = deferred.confirmationId as Id<"toolConfirmationRequests">;
  await ctx.runMutation(internal.tool_confirmations.mutations.bindCheckpoint, {
    chatId: args.chatId,
    messageId: args.messageId,
    jobId: args.jobId,
    userId: args.userId,
    confirmationId,
    toolCallId: deferred.toolCallId,
    checkpoint: {
      ...checkpoint,
      roundKey: args.workflowResumeEventId,
      deferredResumeEventId: args.workflowResumeEventId,
      deferredOwnership: {
        kind: "tool_confirmation",
        confirmationId,
        toolCallId: deferred.toolCallId,
      },
      group: {
        ...checkpoint.group,
        executionAttemptId: args.executionAttemptId,
        executionFence: args.executionFence,
      },
    },
  });
}
