import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function deleteRuntimeNativeAgentsForChatBatch(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  limit: number,
): Promise<boolean> {
  const groups = await ctx.db.query("runtimeNativeAgentGroups")
    .withIndex("by_chat", (index) => index.eq("chatId", chatId))
    .take(limit);
  let hasMore = groups.length === limit;
  for (const group of groups) {
    const agents = await ctx.db.query("runtimeNativeAgents")
      .withIndex("by_group_ordinal", (index) => index.eq("groupId", group._id))
      .take(limit);
    for (const agent of agents) await ctx.db.delete(agent._id);
    if (agents.length < limit) {
      await ctx.db.delete(group._id);
    } else {
      hasMore = true;
    }
  }
  return hasMore;
}
