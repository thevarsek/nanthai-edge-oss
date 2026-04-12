"use node";

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
  await ctx.runMutation(internal.chat.mutations.saveGenerationContinuation, {
    chatId: args.chatId,
    messageId: args.participant.messageId,
    jobId: args.participant.jobId,
    userId: args.userId,
    checkpoint,
  });

  const scheduledId = await ctx.scheduler.runAfter(
    0,
    internal.chat.actions.runGenerationParticipant,
    {
      ...args,
      resumeExpected: true,
    },
  );

  await ctx.runMutation(internal.chat.mutations.setGenerationContinuationScheduled, {
    jobId: args.participant.jobId,
    scheduledFunctionId: scheduledId,
  });
}
