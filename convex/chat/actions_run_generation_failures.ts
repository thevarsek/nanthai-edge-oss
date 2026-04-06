import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  isGenerationCancelledError,
} from "./generation_helpers";
import { RunGenerationArgs } from "./actions_run_generation_types";

export async function failPendingParticipants(
  ctx: ActionCtx,
  args: RunGenerationArgs,
  rawError: unknown,
): Promise<void> {
  const errorMessage =
    rawError instanceof Error ? rawError.message : "Unknown generation error";
  const wasCancelled = isGenerationCancelledError(rawError);
  const finalStatus = wasCancelled ? "cancelled" : "failed";
  const finalContent = wasCancelled
    ? "[Generation cancelled]"
    : `Error: ${errorMessage}`;

  await Promise.all(
    args.participants.map(async (participant) => {
      try {
        const message = await ctx.runQuery(internal.chat.queries.getMessageInternal, {
          messageId: participant.messageId,
        });

        if (!message) return;
        if (message.status !== "pending" && message.status !== "streaming") {
          return;
        }

        await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
          messageId: participant.messageId,
          jobId: participant.jobId,
          chatId: args.chatId,
          content: finalContent,
          status: finalStatus,
          error: errorMessage,
          userId: args.userId,
        });
      } catch (finalizeError) {
        console.error(
          "Failed to finalize pending participant after top-level generation error",
          finalizeError,
        );
      }
    }),
  );
}
