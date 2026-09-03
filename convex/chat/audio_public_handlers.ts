import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { requireAuth } from "../lib/auth";
import { getAuthorizedMessage } from "./query_helpers";
import { startMessageAudioWorkflow } from "./audio_workflow_start";

const defaultDeps = { startMessageAudioWorkflow };

export type RequestAudioGenerationDeps = typeof defaultDeps;

export async function requestAudioGenerationHandler(
  ctx: MutationCtx,
  args: { messageId: Id<"messages"> },
  deps: RequestAudioGenerationDeps = defaultDeps,
): Promise<{ scheduled: true; alreadyExists?: true }> {
  const { userId } = await requireAuth(ctx);
  const message = await getAuthorizedMessage(ctx, args.messageId, userId);
  if (!message || message.role !== "assistant") {
    throw new ConvexError({ code: "NOT_FOUND", message: "Assistant message not found." });
  }
  if (!message.content?.trim()) {
    throw new ConvexError({ code: "VALIDATION", message: "Message has no text to voice." });
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

  const started = await deps.startMessageAudioWorkflow(ctx, {
    messageId: args.messageId,
    chatId: message.chatId,
    userId,
  });
  return started.started
    ? { scheduled: true }
    : { scheduled: true, alreadyExists: true };
}
