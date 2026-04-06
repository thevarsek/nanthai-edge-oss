// convex/nodePositions/queries.ts
// =============================================================================
// Node Position queries for ideascape canvas layout.
// =============================================================================

import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireAuth } from "../lib/auth";

/** List all node positions for a chat. */
export const listByChat = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) {
      return [];
    }

    return await ctx.db
      .query("nodePositions")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .take(2000);
  },
});
