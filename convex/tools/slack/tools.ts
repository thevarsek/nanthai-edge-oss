// convex/tools/slack/tools.ts
// =============================================================================
// Slack MCP tool wrappers — 10 NanthAI tools mapping to Slack's hosted MCP
// server tools. Each tool calls callSlackMcpTool() which handles the
// initialize → notifications/initialized → tools/call handshake.
// =============================================================================

import { createTool } from "../registry";
import { getSlackAccessToken } from "./auth";
import { callSlackMcpTool } from "./client";

// ---------------------------------------------------------------------------
// Helper: extract text from MCP tool result
// ---------------------------------------------------------------------------

function extractText(
  content: Array<{ type: string; text?: string }>,
): string {
  return content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("\n");
}

/**
 * Shared wrapper: authenticate, call the Slack MCP tool, and normalize the
 * result into our standard { success, data, error? } shape.
 */
async function runSlackTool(
  toolCtx: Parameters<Parameters<typeof createTool>[0]["execute"]>[0],
  mcpToolName: string,
  mcpArgs: Record<string, unknown>,
): Promise<{ success: boolean; data: string | null; error?: string }> {
  const { accessToken } = await getSlackAccessToken(toolCtx.ctx, toolCtx.userId);
  const result = await callSlackMcpTool(toolCtx, accessToken, mcpToolName, mcpArgs);
  if (result.isError) {
    return { success: false, data: null, error: extractText(result.content) };
  }
  return { success: true, data: extractText(result.content) };
}

// ---------------------------------------------------------------------------
// slack_search_messages
// ---------------------------------------------------------------------------

export const slackSearchMessages = createTool({
  name: "slack_search_messages",
  description:
    "Search for messages in the user's Slack workspace. " +
    "Supports free-text queries with Slack search modifiers (from:, in:, has:, before:, after:). " +
    "Returns matching messages with channel, author, timestamp, and text.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query. Supports Slack search modifiers like from:@user, in:#channel, has:link, before:2024-01-01.",
      },
      count: {
        type: "number",
        description: "Number of results to return (default 20, max 100).",
      },
      sort: {
        type: "string",
        description: "Sort order: 'score' (relevance) or 'timestamp' (newest first).",
      },
    },
    required: ["query"],
  },
  execute: async (toolCtx, args) => {
    const mcpArgs: Record<string, unknown> = { query: args.query };
    if (typeof args.count === "number") mcpArgs.count = Math.max(1, Math.min(args.count as number, 100));
    if (args.sort) mcpArgs.sort = args.sort;
    return runSlackTool(toolCtx, "slack_search_messages", mcpArgs);
  },
});

// ---------------------------------------------------------------------------
// slack_search_users
// ---------------------------------------------------------------------------

export const slackSearchUsers = createTool({
  name: "slack_search_users",
  description:
    "Search for users in the Slack workspace by name, email, or display name.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query for user name, display name, or email.",
      },
    },
    required: ["query"],
  },
  execute: async (toolCtx, args) => {
    return runSlackTool(toolCtx, "slack_search_users", { query: args.query });
  },
});

// ---------------------------------------------------------------------------
// slack_search_channels
// ---------------------------------------------------------------------------

export const slackSearchChannels = createTool({
  name: "slack_search_channels",
  description:
    "Search for channels in the Slack workspace by name or topic.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query for channel name or topic.",
      },
    },
    required: ["query"],
  },
  execute: async (toolCtx, args) => {
    return runSlackTool(toolCtx, "slack_search_channels", { query: args.query });
  },
});

// ---------------------------------------------------------------------------
// slack_send_message
// ---------------------------------------------------------------------------

export const slackSendMessage = createTool({
  name: "slack_send_message",
  description:
    "Send a message to a Slack channel or DM. Requires the chat:write scope. " +
    "Can send to a channel by ID or name, or to a user by ID.",
  parameters: {
    type: "object",
    properties: {
      channel: {
        type: "string",
        description: "Channel ID (e.g. C1234567890), channel name (e.g. #general), or user ID for DMs.",
      },
      text: {
        type: "string",
        description: "Message text (supports Slack mrkdwn formatting).",
      },
      thread_ts: {
        type: "string",
        description: "Thread timestamp to reply to (for threaded messages).",
      },
    },
    required: ["channel", "text"],
  },
  execute: async (toolCtx, args) => {
    const mcpArgs: Record<string, unknown> = {
      channel: args.channel,
      text: args.text,
    };
    if (args.thread_ts) mcpArgs.thread_ts = args.thread_ts;
    return runSlackTool(toolCtx, "slack_send_message", mcpArgs);
  },
});

// ---------------------------------------------------------------------------
// slack_read_channel
// ---------------------------------------------------------------------------

export const slackReadChannel = createTool({
  name: "slack_read_channel",
  description:
    "Read recent messages from a Slack channel. Returns the latest messages " +
    "with author, timestamp, and text.",
  parameters: {
    type: "object",
    properties: {
      channel: {
        type: "string",
        description: "Channel ID (e.g. C1234567890) or name (e.g. #general).",
      },
      limit: {
        type: "number",
        description: "Number of messages to fetch (default 20, max 100).",
      },
      oldest: {
        type: "string",
        description: "Only messages after this timestamp (Unix epoch string).",
      },
      latest: {
        type: "string",
        description: "Only messages before this timestamp (Unix epoch string).",
      },
    },
    required: ["channel"],
  },
  execute: async (toolCtx, args) => {
    const mcpArgs: Record<string, unknown> = { channel: args.channel };
    if (typeof args.limit === "number") mcpArgs.limit = Math.max(1, Math.min(args.limit as number, 100));
    if (args.oldest) mcpArgs.oldest = args.oldest;
    if (args.latest) mcpArgs.latest = args.latest;
    return runSlackTool(toolCtx, "slack_read_channel", mcpArgs);
  },
});

// ---------------------------------------------------------------------------
// slack_read_thread
// ---------------------------------------------------------------------------

export const slackReadThread = createTool({
  name: "slack_read_thread",
  description:
    "Read all replies in a Slack thread. Returns the full conversation thread.",
  parameters: {
    type: "object",
    properties: {
      channel: {
        type: "string",
        description: "Channel ID where the thread is located.",
      },
      thread_ts: {
        type: "string",
        description: "Thread parent message timestamp.",
      },
      limit: {
        type: "number",
        description: "Number of replies to fetch (default 50, max 200).",
      },
    },
    required: ["channel", "thread_ts"],
  },
  execute: async (toolCtx, args) => {
    const mcpArgs: Record<string, unknown> = {
      channel: args.channel,
      thread_ts: args.thread_ts,
    };
    if (typeof args.limit === "number") mcpArgs.limit = Math.max(1, Math.min(args.limit as number, 200));
    return runSlackTool(toolCtx, "slack_read_thread", mcpArgs);
  },
});

// ---------------------------------------------------------------------------
// slack_create_canvas
// ---------------------------------------------------------------------------

export const slackCreateCanvas = createTool({
  name: "slack_create_canvas",
  description:
    "Create a new Slack Canvas document. Requires the canvases:write scope.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Canvas title.",
      },
      content: {
        type: "string",
        description: "Canvas content in markdown format.",
      },
      channel: {
        type: "string",
        description: "Optional channel ID to share the canvas in.",
      },
    },
    required: ["title", "content"],
  },
  execute: async (toolCtx, args) => {
    const mcpArgs: Record<string, unknown> = {
      title: args.title,
      content: args.content,
    };
    if (args.channel) mcpArgs.channel = args.channel;
    return runSlackTool(toolCtx, "slack_create_canvas", mcpArgs);
  },
});

// ---------------------------------------------------------------------------
// slack_update_canvas
// ---------------------------------------------------------------------------

export const slackUpdateCanvas = createTool({
  name: "slack_update_canvas",
  description:
    "Update an existing Slack Canvas. Requires the canvases:write scope.",
  parameters: {
    type: "object",
    properties: {
      canvas_id: {
        type: "string",
        description: "Canvas ID to update.",
      },
      content: {
        type: "string",
        description: "New content for the canvas in markdown format.",
      },
    },
    required: ["canvas_id", "content"],
  },
  execute: async (toolCtx, args) => {
    return runSlackTool(toolCtx, "slack_update_canvas", {
      canvas_id: args.canvas_id,
      content: args.content,
    });
  },
});

// ---------------------------------------------------------------------------
// slack_read_canvas
// ---------------------------------------------------------------------------

export const slackReadCanvas = createTool({
  name: "slack_read_canvas",
  description:
    "Read the content of a Slack Canvas. Requires the canvases:read scope.",
  parameters: {
    type: "object",
    properties: {
      canvas_id: {
        type: "string",
        description: "Canvas ID to read.",
      },
    },
    required: ["canvas_id"],
  },
  execute: async (toolCtx, args) => {
    return runSlackTool(toolCtx, "slack_read_canvas", { canvas_id: args.canvas_id });
  },
});

// ---------------------------------------------------------------------------
// slack_read_user_profile
// ---------------------------------------------------------------------------

export const slackReadUserProfile = createTool({
  name: "slack_read_user_profile",
  description:
    "Read a Slack user's profile information including name, title, email, " +
    "status, and timezone.",
  parameters: {
    type: "object",
    properties: {
      user_id: {
        type: "string",
        description: "Slack user ID (e.g. U1234567890).",
      },
    },
    required: ["user_id"],
  },
  execute: async (toolCtx, args) => {
    return runSlackTool(toolCtx, "slack_read_user_profile", { user_id: args.user_id });
  },
});
