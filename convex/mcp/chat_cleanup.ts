import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function deleteChatMcpInvocationsBatch(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  limit: number,
): Promise<boolean> {
  const invocations = await ctx.db
    .query("mcpInvocations")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .take(limit);

  for (const invocation of invocations) {
    for (const item of invocation.contentItems ?? []) {
      if (item.storageId) {
        await ctx.storage.delete(item.storageId).catch(() => undefined);
      }
    }
    await ctx.db.delete(invocation._id);
  }

  return invocations.length === limit;
}
