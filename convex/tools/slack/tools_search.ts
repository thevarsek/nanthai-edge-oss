// convex/tools/slack/tools_search.ts
// =============================================================================
// Slack search tools: messages (public or public+private), channels, users.
// =============================================================================

import { createTool } from "../registry";
import { assignOptional, runSlackTool } from "./tools_shared";

// ---------------------------------------------------------------------------
// slack_search_messages
// Single stable NanthAI tool name. include_private flag selects the underlying
// MCP tool (slack_search_public vs slack_search_public_and_private).
// ---------------------------------------------------------------------------

export const slackSearchMessages = createTool({
  name: "slack_search_messages",
  description:
    "Search messages and files in the user's Slack workspace. Supports Slack search modifiers " +
    "(from:@user, in:#channel, has:link, before:YYYY-MM-DD, after:YYYY-MM-DD) and semantic " +
    "queries. Set include_private=false to restrict to public channels only.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query. Supports modifiers: in:#channel, from:@user, has:link, before:YYYY-MM-DD.",
      },
      include_private: {
        type: "boolean",
        description:
          "When true (default), searches public + private channels, DMs, and group DMs. When false, public channels only.",
      },
      channel_types: {
        type: "string",
        description:
          "Only used when include_private=true. Comma-separated subset of: public_channel, private_channel, mpim, im.",
      },
      content_types: {
        type: "string",
        description: "Comma-separated: 'messages' and/or 'files'.",
      },
      context_channel_id: {
        type: "string",
        description: "Optional channel ID to boost relevance for that channel.",
      },
      cursor: { type: "string", description: "Pagination cursor." },
      limit: { type: "number", description: "Max results (1-20, default 20)." },
      after: { type: "string", description: "Unix timestamp lower bound (inclusive)." },
      before: { type: "string", description: "Unix timestamp upper bound (inclusive)." },
      include_bots: { type: "boolean", description: "Include bot messages (default false)." },
      sort: { type: "string", description: "'score' (default) or 'timestamp'." },
      sort_dir: { type: "string", description: "'asc' or 'desc'." },
      response_format: { type: "string", description: "'detailed' (default) or 'concise'." },
      include_context: {
        type: "boolean",
        description: "Include surrounding context messages (default true).",
      },
      max_context_length: {
        type: "number",
        description: "Max chars per context message.",
      },
    },
    required: ["query"],
  },
  execute: async (toolCtx, args) => {
    const includePrivate = args.include_private !== false;
    const mcpToolName = includePrivate
      ? "slack_search_public_and_private"
      : "slack_search_public";

    const mcpArgs: Record<string, unknown> = { query: args.query };
    if (typeof args.limit === "number") {
      mcpArgs.limit = Math.max(1, Math.min(args.limit as number, 20));
    }
    if (typeof args.max_context_length === "number") {
      mcpArgs.max_context_length = args.max_context_length;
    }
    const optional: Record<string, unknown> = {
      content_types: args.content_types,
      context_channel_id: args.context_channel_id,
      cursor: args.cursor,
      after: args.after,
      before: args.before,
      include_bots: args.include_bots,
      sort: args.sort,
      sort_dir: args.sort_dir,
      response_format: args.response_format,
      include_context: args.include_context,
    };
    if (includePrivate) {
      optional.channel_types = args.channel_types;
    }
    assignOptional(mcpArgs, optional);
    return runSlackTool(toolCtx, mcpToolName, mcpArgs);
  },
});

// ---------------------------------------------------------------------------
// slack_search_channels  (MCP: slack_search_channels)
// ---------------------------------------------------------------------------

export const slackSearchChannels = createTool({
  name: "slack_search_channels",
  description:
    "Search Slack channels by name/description. Returns IDs, names, topics, purposes. " +
    "Use this first to resolve a channel name like '#general' to an ID (C...).",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Name/description keywords." },
      channel_types: {
        type: "string",
        description: "Comma-separated: public_channel, private_channel (default: public_channel).",
      },
      cursor: { type: "string", description: "Pagination cursor." },
      limit: { type: "number", description: "Max results (1-20, default 20)." },
      response_format: { type: "string", description: "'detailed' or 'concise'." },
      include_archived: {
        type: "boolean",
        description: "Include archived channels (default false).",
      },
    },
    required: ["query"],
  },
  execute: async (toolCtx, args) => {
    const mcpArgs: Record<string, unknown> = { query: args.query };
    if (typeof args.limit === "number") {
      mcpArgs.limit = Math.max(1, Math.min(args.limit as number, 20));
    }
    assignOptional(mcpArgs, {
      channel_types: args.channel_types,
      cursor: args.cursor,
      response_format: args.response_format,
      include_archived: args.include_archived,
    });
    return runSlackTool(toolCtx, "slack_search_channels", mcpArgs);
  },
});

// ---------------------------------------------------------------------------
// slack_search_users  (MCP: slack_search_users)
// ---------------------------------------------------------------------------

export const slackSearchUsers = createTool({
  name: "slack_search_users",
  description:
    "Search Slack users by name, email, department, role, title. Space-separated terms = AND. " +
    "Use to resolve a user name to an ID (U...).",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Full name, partial name, email, or attribute keywords.",
      },
      cursor: { type: "string", description: "Pagination cursor." },
      limit: { type: "number", description: "Max results (1-20, default 20)." },
      response_format: { type: "string", description: "'detailed' or 'concise'." },
    },
    required: ["query"],
  },
  execute: async (toolCtx, args) => {
    const mcpArgs: Record<string, unknown> = { query: args.query };
    if (typeof args.limit === "number") {
      mcpArgs.limit = Math.max(1, Math.min(args.limit as number, 20));
    }
    assignOptional(mcpArgs, {
      cursor: args.cursor,
      response_format: args.response_format,
    });
    return runSlackTool(toolCtx, "slack_search_users", mcpArgs);
  },
});
