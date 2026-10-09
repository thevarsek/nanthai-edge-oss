import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export async function deleteWorkForChatBatch(ctx: MutationCtx, chatId: Id<"chats">, limit: number) {
  let more = false;
  for (const table of ["collaborationWork", "collaborationRequirements", "collaborationReviews", "collaborationSettings", "collaborationWorkOperations"] as const) {
    const rows = await ctx.db.query(table).withIndex("by_chat", (q) => q.eq("chatId", chatId)).take(limit);
    for (const row of rows) await ctx.db.delete(row._id);
    more = more || rows.length === limit;
  }
  return more;
}
