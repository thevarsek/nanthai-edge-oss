import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertCurrentExecution } from "../execution/attempts";
import type {
  MessageAudioExecutionMutationArgs,
  PatchMessageAudioMutationArgs,
} from "./audio_refs";

async function getOwnedMessage(
  ctx: MutationCtx,
  args: MessageAudioExecutionMutationArgs,
): Promise<Doc<"messages">> {
  const current = await assertCurrentExecution(ctx, {
    attemptId: args.executionAttemptId,
    fence: args.executionFence,
  });
  if (
    current.run._id !== args.executionRunId
    || current.run.domainType !== "message_speech"
    || current.run.sourceMessageId !== args.messageId
  ) throw new Error("MESSAGE_AUDIO_EXECUTION_MISMATCH");
  const message = await ctx.db.get(args.messageId);
  if (!message || message.chatId !== current.run.chatId) {
    throw new Error("MESSAGE_AUDIO_TARGET_NOT_FOUND");
  }
  return message;
}

export async function patchMessageAudioHandler(
  ctx: MutationCtx,
  args: PatchMessageAudioMutationArgs,
): Promise<void> {
  const existing = await getOwnedMessage(ctx, args);
  if (
    existing.audioStorageId
    && existing.audioStorageId !== args.audioStorageId
  ) {
    try {
      await ctx.storage.delete(existing.audioStorageId);
    } catch {
      // Storage blob may already be deleted.
    }
  }
  await ctx.db.patch(args.messageId, {
    audioStorageId: args.audioStorageId,
    audioMimeType: args.audioMimeType,
    audioSource: "read_aloud",
    audioDurationMs: args.audioDurationMs,
    audioVoice: args.audioVoice,
    audioTranscript: args.audioTranscript,
    audioGeneratedAt: args.audioGeneratedAt,
    audioGenerating: undefined,
  });
}

export async function clearAudioGeneratingHandler(
  ctx: MutationCtx,
  args: MessageAudioExecutionMutationArgs,
): Promise<void> {
  const message = await getOwnedMessage(ctx, args);
  if (message.audioGenerating === true) {
    await ctx.db.patch(message._id, { audioGenerating: undefined });
  }
}
