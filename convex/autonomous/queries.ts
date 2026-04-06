// convex/autonomous/queries.ts
// =============================================================================
// Autonomous session queries: reactive subscriptions for UI state.
//
// The iOS client subscribes to `watchSession` to drive the autonomous mode
// UI: cycle counter, stop button, participant indicator, status badge.
// =============================================================================

import { v } from "convex/values";
import { query, internalQuery } from "../_generated/server";
import { requireAuth } from "../lib/auth";

// -- Public queries -----------------------------------------------------------

/** Watch autonomous session state. iOS subscribes reactively. */
export const watchSession = query({
  args: { sessionId: v.id("autonomousSessions") },
  returns: v.union(
    v.object({
      _id: v.id("autonomousSessions"),
      _creationTime: v.number(),
      chatId: v.id("chats"),
      userId: v.string(),
      status: v.string(),
      currentCycle: v.number(),
      maxCycles: v.number(),
      currentParticipantIndex: v.optional(v.number()),
      turnOrder: v.array(v.string()),
      moderatorParticipantId: v.optional(v.string()),
      autoStopOnConsensus: v.boolean(),
      pauseBetweenTurns: v.number(),
      parentMessageIds: v.array(v.id("messages")),
      stopReason: v.optional(v.string()),
      error: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;
    if (session.userId !== userId) return null;
    return {
      _id: session._id,
      _creationTime: session._creationTime,
      chatId: session.chatId,
      userId: session.userId,
      status: session.status,
      currentCycle: session.currentCycle,
      maxCycles: session.maxCycles,
      currentParticipantIndex: session.currentParticipantIndex,
      turnOrder: session.turnOrder,
      moderatorParticipantId: session.moderatorParticipantId,
      autoStopOnConsensus: session.autoStopOnConsensus,
      pauseBetweenTurns: session.pauseBetweenTurns,
      parentMessageIds: session.parentMessageIds,
      stopReason: session.stopReason,
      error: session.error,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  },
});

/** List active autonomous sessions for a chat. */
export const listActiveSessions = query({
  args: { chatId: v.id("chats") },
  returns: v.array(
    v.object({
      _id: v.id("autonomousSessions"),
      status: v.string(),
      currentCycle: v.number(),
      maxCycles: v.number(),
      currentParticipantIndex: v.optional(v.number()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) {
      return [];
    }
    const running = await ctx.db
      .query("autonomousSessions")
      .withIndex("by_chat_status", (q) =>
        q.eq("chatId", args.chatId).eq("status", "running"),
      )
      .take(100);
    const paused = await ctx.db
      .query("autonomousSessions")
      .withIndex("by_chat_status", (q) =>
        q.eq("chatId", args.chatId).eq("status", "paused"),
      )
      .take(100);

    return [...running, ...paused]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({
        _id: s._id,
        status: s.status,
        currentCycle: s.currentCycle,
        maxCycles: s.maxCycles,
        currentParticipantIndex: s.currentParticipantIndex,
        createdAt: s.createdAt,
      }));
  },
});

/** List all autonomous sessions for the authenticated user (any status). */
export const listSessions = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("autonomousSessions"),
      chatId: v.id("chats"),
      chatTitle: v.string(),
      status: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const sessions = await ctx.db
      .query("autonomousSessions")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);

    const uniqueChatIds = [...new Set(sessions.map((session) => session.chatId))];
    const chats = await Promise.all(
      uniqueChatIds.map(async (chatId) => [chatId, await ctx.db.get(chatId)] as const),
    );
    const chatTitles = new Map(chats.map(([chatId, chat]) => [chatId, chat?.title ?? "Untitled"]));

    return sessions.map((session) => ({
      _id: session._id,
      chatId: session.chatId,
      chatTitle: chatTitles.get(session.chatId) ?? "Untitled",
      status: session.status,
      createdAt: session.createdAt,
    }));
  },
});

// -- Internal queries ---------------------------------------------------------

/** Get full session document (for actions). */
export const getSession = internalQuery({
  args: { sessionId: v.id("autonomousSessions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

/** Get recent messages for moderator/consensus context. */
export const recentMessages = internalQuery({
  args: {
    chatId: v.id("chats"),
    count: v.number(),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .order("desc")
      .take(args.count * 2); // Over-fetch to filter

    // Filter to user/assistant messages and return in chronological order
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(0, args.count)
      .reverse()
      .map((m) => ({
        role: m.role,
        content: m.content.substring(0, 500),
        participantName: m.participantName,
        modelId: m.modelId,
      }));
  },
});
