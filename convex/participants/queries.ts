import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireAuth } from "../lib/auth";

// =============================================================================
// Chat Participant Queries
// =============================================================================

/** List participants for a chat, sorted by sortOrder. */
export const listByChat = query({
  args: {
    chatId: v.id("chats"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) {
      return [];
    }

    const participants = await ctx.db
      .query("chatParticipants")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();

    return participants.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

/** Get a single participant. */
export const get = query({
  args: {
    participantId: v.id("chatParticipants"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const participant = await ctx.db.get(args.participantId);
    if (!participant || participant.userId !== userId) {
      return null;
    }

    return participant;
  },
});
