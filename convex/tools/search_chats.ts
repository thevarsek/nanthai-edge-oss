// convex/tools/search_chats.ts
// =============================================================================
// AI tool: search_chats — full-text search across the user's chat messages.
//
// Uses the Convex search index on `messages.content` to find relevant past
// conversations. Results are scoped to the requesting user's chats and
// enriched with chat titles and truncated message snippets.
//
// Tier 1 tool (always on, no OAuth required).
// =============================================================================

import { internal } from "../_generated/api";
import { createTool } from "./registry";

/** Internal query reference for chat search (defined inline below). */
// We need an internalQuery for the search since tools run in ActionCtx.
// The search query is added to convex/chat/queries.ts as searchMessagesInternal.

export const searchChats = createTool({
  name: "search_chats",
  description:
    "Search across the user's previous chat messages for relevant content. " +
    "Useful when the user asks 'what did we discuss about X?', 'find where I " +
    "mentioned Y', or 'have we talked about Z before?'. Returns matching " +
    "messages with chat titles and content snippets.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search terms to find in message content.",
      },
      limit: {
        type: "number",
        description: "Maximum number of results to return (default 10, max 25).",
      },
    },
    required: ["query"],
  },

  execute: async (toolCtx, args) => {
    const query = args.query as string | undefined;
    const rawLimit = args.limit as number | undefined;
    const limit = Math.floor(Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit! : 10, 1), 25));

    if (!query || typeof query !== "string" || !query.trim()) {
      return { success: false, data: null, error: "Missing or empty 'query'" };
    }

    try {
      const results = await toolCtx.ctx.runQuery(
        internal.chat.queries.searchMessagesInternal,
        { userId: toolCtx.userId, searchQuery: query.trim(), limit },
      );

      if (results.length === 0) {
        return {
          success: true,
          data: {
            results: [],
            totalFound: 0,
            message: `No messages found matching "${query.trim()}".`,
          },
        };
      }

      return {
        success: true,
        data: {
          results,
          totalFound: results.length,
          message:
            `Found ${results.length} message${results.length === 1 ? "" : "s"} ` +
            `across ${new Set(results.map((r: Record<string, unknown>) => r.chatId)).size} ` +
            `chat${new Set(results.map((r: Record<string, unknown>) => r.chatId)).size === 1 ? "" : "s"} ` +
            `matching "${query.trim()}".`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to search chats: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
