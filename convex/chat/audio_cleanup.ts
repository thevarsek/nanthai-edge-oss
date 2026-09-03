import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";

export const ACTIVE_MESSAGE_SPEECH_EXECUTION_STATES = [
  "queued",
  "running",
  "waiting",
  "waiting_for_input",
  "waiting_for_permission",
  "interrupted",
] as const;

const ACTIVE_MESSAGE_SPEECH_EXECUTION_STATE_SET = new Set<string>(
  ACTIVE_MESSAGE_SPEECH_EXECUTION_STATES,
);

async function hasAnotherActiveMessageSpeechRun(
  ctx: MutationCtx,
  args: {
    userId: string;
    messageId: Id<"messages">;
    excludingRunId?: Id<"executionRuns">;
  },
): Promise<boolean> {
  const runs = await ctx.db
    .query("executionRuns")
    .withIndex("by_user_domain", (query) => query
      .eq("userId", args.userId)
      .eq("domainType", "message_speech")
      .eq("domainId", String(args.messageId)))
    .collect();
  return runs.some((candidate) =>
    candidate._id !== args.excludingRunId
    && ACTIVE_MESSAGE_SPEECH_EXECUTION_STATE_SET.has(candidate.state)
  );
}

export async function clearAudioGenerationForExecutionRun(
  ctx: MutationCtx,
  run: Doc<"executionRuns">,
): Promise<void> {
  if (run.domainType !== "message_speech" || !run.sourceMessageId) return;
  if (await hasAnotherActiveMessageSpeechRun(ctx, {
    userId: run.userId,
    messageId: run.sourceMessageId,
    excludingRunId: run._id,
  })) return;
  const message = await ctx.db.get(run.sourceMessageId);
  if (
    message
    && message.chatId === run.chatId
    && message.audioGenerating === true
  ) {
    await ctx.db.patch(message._id, { audioGenerating: undefined });
  }
}

/** Compatibility cleanup for scheduled pre-M52 audio actions already in flight. */
export const clearLegacyAudioGeneration = internalMutation({
  args: { messageId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.role !== "assistant" || message.audioGenerating !== true) {
      return null;
    }
    const chat = await ctx.db.get(message.chatId);
    if (!chat || await hasAnotherActiveMessageSpeechRun(ctx, {
      userId: chat.userId,
      messageId: message._id,
    })) return null;
    await ctx.db.patch(message._id, { audioGenerating: undefined });
    return null;
  },
});
