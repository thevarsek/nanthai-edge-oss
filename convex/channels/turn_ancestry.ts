import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Media reserves a user-message leaf before its replies exist. Resolve that
 * edge at dispatch, after the preceding queued turn has committed its replies. */
export async function resolvePreparedMediaParents(ctx: MutationCtx, turn: Doc<"channelTurns">) {
  const message = await ctx.db.get(turn.userMessageId);
  if (!message || message.chatId !== turn.chatId || message.userId !== turn.userId) return;
  const parents = [];
  for (const parentId of message.parentMessageIds) {
    const input = await ctx.db.query("channelInbox")
      .withIndex("by_message", q => q.eq("canonicalMessageId", parentId)).unique();
    const previous = input?.files?.length && input.status === "accepted"
      ? await ctx.db.query("channelTurns").withIndex("by_message", q => q.eq("userMessageId", parentId)).first()
      : null;
    if (!previous || previous.chatId !== turn.chatId || previous.userId !== turn.userId
      || !["completed", "cancelled", "failed"].includes(previous.status)) {
      parents.push(parentId); continue;
    }
    const replies = await Promise.all(previous.generationArgs.assistantMessageIds.map(id => ctx.db.get(id)));
    const committed = replies.filter((reply): reply is Doc<"messages"> => Boolean(reply && reply.chatId === turn.chatId
      && reply.userId === turn.userId && ["completed", "failed", "cancelled"].includes(reply.status)));
    parents.push(...(committed.length === replies.length && committed.length
      ? committed.map(reply => reply._id) : [parentId]));
  }
  if (JSON.stringify(parents) !== JSON.stringify(message.parentMessageIds)) {
    await ctx.db.patch(message._id, {parentMessageIds: [...new Set(parents)]});
  }
}
