import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { requestRunTreeTeardown } from "../../execution/teardown_graph";
import { wakeChannelTurns } from "../turn_queue";

export async function cancelPreparingTelegramInputs(
  ctx: MutationCtx,
  args: { chatId: Id<"chats">; userId: string; identityId?: Id<"channelIdentities"> },
): Promise<number> {
  const chat = await ctx.db.get(args.chatId);
  if (!chat || chat.userId !== args.userId || chat.channelConversation !== true) return 0;
  const inputs = await ctx.db.query("channelInbox").withIndex("by_chat_status", query =>
    query.eq("chatId", args.chatId).eq("status", "received")).collect();
  let count = 0;
  for (const input of inputs) {
    if (input.userId !== args.userId || !input.files?.length || !input.canonicalMessageId ||
      (args.identityId && input.identityId !== args.identityId)) continue;
    await ctx.db.patch(input._id, { status: "failed", error: "Input preparation was cancelled. You can retry the retained input in NanthAI." });
    await ctx.db.patch(input.canonicalMessageId, { status: "cancelled", inputProcessingNotice: undefined });
    if (input.admissionRunId) {
      const run = await ctx.db.get(input.admissionRunId);
      if (run?.userId === args.userId && !["completed", "failed", "cancelled"].includes(run.state)) {
        const reason = "Telegram input preparation cancelled by its owner";
        await requestRunTreeTeardown(ctx, run._id, args.userId, reason);
        await ctx.scheduler.runAfter(0, internal.execution.teardown.cancelRunTree, { runId: run._id, requestedBy: args.userId, reason });
      }
    }
    count += 1;
  }
  if (count) await wakeChannelTurns(ctx, args.chatId);
  return count;
}
