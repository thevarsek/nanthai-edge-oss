import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const CHAT_TABLES = ["channelBindings", "channelInbox", "channelDeliveries", "channelTurns",
  "conversationSummaries", "conversationSummarySources", "conversationCompactions", "conversationCompactionChunks"] as const;
export async function deleteChannelConversationBatch(ctx: MutationCtx, chatId: Id<"chats">, limit: number) {
  let remains = false;
  for (const table of CHAT_TABLES) {
    const rows = await ctx.db.query(table).withIndex("by_chat", q => q.eq("chatId", chatId)).take(limit);
    for (const row of rows) await ctx.db.delete(row._id);
    remains ||= rows.length === limit;
  }
  return remains;
}
