import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { isAccountActive } from "./account_access";

/**
 * Transactional last-mile fence for internal/background writers. Authentication
 * checks at action start are insufficient because deletion or an account block
 * can begin while an external request is in flight.
 */
export async function isUserDataWritable(
  ctx: MutationCtx,
  userId: string,
  chatId?: Id<"chats">,
): Promise<boolean> {
  if (!await isAccountActive(ctx.db, userId)) return false;
  if (!chatId) return true;
  const chat = await ctx.db.get(chatId);
  return Boolean(chat && chat.userId === userId && chat.isDeleting !== true);
}

export async function assertUserDataWritable(
  ctx: MutationCtx,
  userId: string,
  chatId?: Id<"chats">,
): Promise<void> {
  if (!await isUserDataWritable(ctx, userId, chatId)) {
    throw new Error("USER_DATA_NOT_WRITABLE");
  }
}

export const isWritable = internalQuery({
  args: { userId: v.string(), chatId: v.optional(v.id("chats")) },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    if (!await isAccountActive(ctx.db, args.userId)) return false;
    if (!args.chatId) return true;
    const chat = await ctx.db.get(args.chatId);
    return chat?.userId === args.userId && chat.isDeleting !== true;
  },
});
