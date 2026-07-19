import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export const isChatWritable = internalQuery({
  args: { chatId: v.id("chats"), userId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const [chat, tombstone] = await Promise.all([
      ctx.db.get(args.chatId),
      ctx.db
        .query("accountDeletionTombstones")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .unique(),
    ]);
    return chat?.userId === args.userId && chat.isDeleting !== true && !tombstone;
  },
});
