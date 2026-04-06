// convex/search/queries.ts
// =============================================================================
// Search session reactive queries for M9 — Internet Search.
//
// iOS subscribes to these for live progress updates.
// =============================================================================

import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";

/**
 * Watch a single search session for real-time progress updates.
 * iOS subscribes to this when a Web Search or Research Paper is active.
 */
export const watchSearchSession = query({
  args: { sessionId: v.id("searchSessions") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      return null;
    }
    return session;
  },
});

/**
 * Watch all search phases for a session (Research Paper intermediate results).
 * Ordered by phaseOrder ascending.
 */
export const watchSearchPhases = query({
  args: { sessionId: v.id("searchSessions") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      return [];
    }

    return await ctx.db
      .query("searchPhases")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
  },
});

/**
 * Watch search sessions for a chat (used to show progress indicators).
 */
export const watchChatSearchSessions = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) {
      return [];
    }

    return await ctx.db
      .query("searchSessions")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .take(100);
  },
});

// -- Internal queries (used by actions/workflows) -----------------------------

/**
 * Get all search phases for a session (used by regenerate action).
 */
export const getSearchPhases = internalQuery({
  args: { sessionId: v.id("searchSessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("searchPhases")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
  },
});

/**
 * Get a search session by ID (used by workflow steps).
 */
export const getSearchSession = internalQuery({
  args: { sessionId: v.id("searchSessions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

/**
 * Get cached search context payload by assistant message.
 */
export const getSearchContextByMessage = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const context = await ctx.db
      .query("searchContexts")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .first();
    return context?.payload ?? null;
  },
});
