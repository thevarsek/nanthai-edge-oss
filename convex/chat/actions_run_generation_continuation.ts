import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  GenerationContinuationCheckpoint,
  RunGenerationParticipantArgs,
} from "./generation_continuation_shared";

export async function scheduleGenerationContinuation(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
  checkpoint: GenerationContinuationCheckpoint,
): Promise<void> {
  if (!args.workflowManaged || !args.workflowResumeEventId) {
    throw new Error("GENERATION_WORKFLOW_ROUND_KEY_REQUIRED");
  }
  const roundKey = args.workflowResumeEventId;
  const durableCheckpoint: GenerationContinuationCheckpoint = args.executionAttemptId &&
    args.executionFence !== undefined
    ? {
        ...checkpoint,
        ...(roundKey ? { roundKey } : {}),
        group: {
          ...checkpoint.group,
          executionAttemptId: args.executionAttemptId,
          executionFence: args.executionFence,
        },
      }
    : {
        ...checkpoint,
        ...(roundKey ? { roundKey } : {}),
      };
  await ctx.runMutation(internal.chat.mutations.saveGenerationContinuation, {
    chatId: args.chatId,
    messageId: args.participant.messageId,
    jobId: args.participant.jobId,
    userId: args.userId,
    checkpoint: durableCheckpoint,
  });
}
