import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { isAccountActive } from "../lib/account_access";

export const isChatWritable = internalQuery({
  args: { chatId: v.id("chats"), userId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const [chat, accountActive] = await Promise.all([
      ctx.db.get(args.chatId),
      isAccountActive(ctx.db, args.userId),
    ]);
    return chat?.userId === args.userId && chat.isDeleting !== true && accountActive;
  },
});
