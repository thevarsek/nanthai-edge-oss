import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requestRunTreeTeardown } from "../execution/teardown_graph";
import {
  ACTIVE_MESSAGE_SPEECH_EXECUTION_STATES,
  clearAudioGenerationForExecutionRun,
} from "./audio_cleanup";

export async function cancelActiveMessageAudioForChat(
  ctx: MutationCtx,
  args: { chatId: Id<"chats">; userId: string },
): Promise<number> {
  const runs = (await Promise.all(ACTIVE_MESSAGE_SPEECH_EXECUTION_STATES.map((state) => ctx.db
    .query("executionRuns")
    .withIndex("by_chat_state", (query) => query
      .eq("chatId", args.chatId)
      .eq("state", state))
    .collect()))).flat();
  let cancelledCount = 0;
  for (const run of runs) {
    if (run.userId !== args.userId || run.domainType !== "message_speech") continue;
    const reason = `Cancelled by ${args.userId}`;
    await requestRunTreeTeardown(ctx, run._id, args.userId, reason);
    await clearAudioGenerationForExecutionRun(ctx, run);
    await ctx.scheduler.runAfter(0, internal.execution.teardown.cancelRunTree, {
      runId: run._id,
      requestedBy: args.userId,
      reason,
    });
    cancelledCount += 1;
  }
  return cancelledCount;
}
