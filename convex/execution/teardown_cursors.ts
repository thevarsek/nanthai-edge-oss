import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

export const saveAccountCancellationCursor = internalMutation({
  args: { userId: v.string(), cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tombstone = await ctx.db
      .query("accountDeletionTombstones")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (tombstone) {
      await ctx.db.patch(tombstone._id, {
        cancellationCursor: args.cursor,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

export const saveChatCancellationCursor = internalMutation({
  args: {
    chatId: v.id("chats"),
    userId: v.string(),
    cursor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const chat = await ctx.db.get(args.chatId);
    if (chat?.userId === args.userId && chat.isDeleting === true) {
      await ctx.db.patch(chat._id, { executionTeardownCursor: args.cursor });
    }
    return null;
  },
});
