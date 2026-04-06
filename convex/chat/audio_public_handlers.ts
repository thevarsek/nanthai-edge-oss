import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { getAuthorizedMessage } from "./query_helpers";

export async function requestAudioGenerationHandler(
  ctx: MutationCtx,
  args: { messageId: Id<"messages"> },
): Promise<{ scheduled: true; alreadyExists?: true }> {
  const { userId } = await requireAuth(ctx);
  const message = await getAuthorizedMessage(ctx, args.messageId, userId);
  if (!message || message.role !== "assistant") {
    throw new Error("Assistant message not found.");
  }
  if (!message.content?.trim()) {
    throw new Error("Message has no text to voice.");
  }

  // Guard: skip duplicate generation if audio already exists or is currently being generated.
  // The action handler also checks audioStorageId, but blocking here avoids
  // wasting a scheduled job on every rapid tap.
  if (message.audioStorageId) {
    return { scheduled: true, alreadyExists: true };
  }
  if (message.audioGenerating) {
    return { scheduled: true, alreadyExists: true };
  }

  // Mark as in-progress before scheduling to prevent duplicate jobs on rapid taps.
  await ctx.db.patch(args.messageId, { audioGenerating: true });

  await ctx.scheduler.runAfter(0, internal.chat.actions.generateAudioForMessage, {
    messageId: args.messageId,
  });
  return { scheduled: true };
}
