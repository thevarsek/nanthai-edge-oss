import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { isExternalMcpResult } from "../chat/external_content";
import { textContainsUrl } from "./fetch_image_provenance";

// Bounded scan: the URL a user wants fetched is almost always in a recent
// message. Older pastes can be repeated in the chat.
const USER_MESSAGE_SCAN_LIMIT = 400;

export const userMessageContainsUrl = internalQuery({
  args: { userId: v.string(), chatId: v.id("chats"), candidates: v.array(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== args.userId || args.candidates.length === 0) return false;
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .order("desc")
      .take(USER_MESSAGE_SCAN_LIMIT);
    return messages.some((message) =>
      message.role === "user"
      && !isExternalMcpResult(message)
      && textContainsUrl(message.content, args.candidates));
  },
});
