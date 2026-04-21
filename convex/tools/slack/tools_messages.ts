// convex/tools/slack/tools_messages.ts
// =============================================================================
// Slack message tools: send, send_draft, schedule, read_channel, read_thread.
// Arg schemas verified via MCP tools/list (see diagnose.ts).
// =============================================================================

import { createTool } from "../registry";
import { assignOptional, runSlackTool } from "./tools_shared";

// ---------------------------------------------------------------------------
// slack_send_message  (MCP: slack_send_message)
// ---------------------------------------------------------------------------

export const slackSendMessage = createTool({
  name: "slack_send_message",
  description:
    "Send a Slack message to a channel or DM. Use a channel ID (C...) or a user ID " +
    "(U...) for DMs. Supports Slack-flavored markdown. For thread replies pass " +
    "thread_ts. Find channel/user IDs via slack_search_channels / slack_search_users first.",
  parameters: {
    type: "object",
    properties: {
      channel_id: {
        type: "string",
        description:
          "Channel ID (e.g. C0123456789) or user ID (U...) for DMs. Use slack_search_channels to resolve names to IDs.",
      },
      message: {
        type: "string",
        description:
          "Message body, up to 5000 chars. Supports markdown (**bold**, _italic_, `code`, lists, links).",
      },
      thread_ts: {
        type: "string",
        description: "Parent message ts value to reply in a thread.",
      },
      reply_broadcast: {
        type: "boolean",
        description: "When replying in a thread, also broadcast the reply to the channel.",
      },
    },
    required: ["channel_id", "message"],
  },
  execute: async (toolCtx, args) => {
    const mcpArgs: Record<string, unknown> = {
      channel_id: args.channel_id,
      message: args.message,
    };
    assignOptional(mcpArgs, {
      thread_ts: args.thread_ts,
      reply_broadcast: args.reply_broadcast,
    });
    return runSlackTool(toolCtx, "slack_send_message", mcpArgs);
  },
});

// ---------------------------------------------------------------------------
// slack_send_message_draft  (MCP: slack_send_message_draft)
// ---------------------------------------------------------------------------

export const slackSendMessageDraft = createTool({
  name: "slack_send_message_draft",
  description:
    "Create a draft Slack message attached to a channel (saved in the user's Drafts & Sent, not sent). " +
    "Use this when the user wants to review before posting. Only one attached draft per channel.",
  parameters: {
    type: "object",
    properties: {
      channel_id: { type: "string", description: "Channel ID (C...) or user ID (U...) for DMs." },
      message: { type: "string", description: "Draft body in standard markdown." },
      thread_ts: { type: "string", description: "Parent message ts to draft a thread reply." },
    },
    required: ["channel_id", "message"],
  },
  execute: async (toolCtx, args) => {
    const mcpArgs: Record<string, unknown> = {
      channel_id: args.channel_id,
      message: args.message,
    };
    assignOptional(mcpArgs, { thread_ts: args.thread_ts });
    return runSlackTool(toolCtx, "slack_send_message_draft", mcpArgs);
  },
});

// ---------------------------------------------------------------------------
// slack_schedule_message  (MCP: slack_schedule_message)
// ---------------------------------------------------------------------------

export const slackScheduleMessage = createTool({
  name: "slack_schedule_message",
  description:
    "Schedule a Slack message for future delivery. post_at is a Unix timestamp at " +
    "least 2 minutes in the future, max 120 days out. Cannot schedule in Slack Connect channels.",
  parameters: {
    type: "object",
    properties: {
      channel_id: { type: "string", description: "Channel ID (C...) or user ID (U...) for DMs." },
      message: { type: "string", description: "Message body in markdown." },
      post_at: {
        type: "number",
        description: "Unix timestamp in seconds (>= now + 120s, <= now + 120 days).",
      },
      thread_ts: { type: "string", description: "Parent message ts for a thread reply." },
      reply_broadcast: {
        type: "boolean",
        description: "Broadcast the thread reply back to the channel.",
      },
    },
    required: ["channel_id", "message", "post_at"],
  },
  execute: async (toolCtx, args) => {
    const mcpArgs: Record<string, unknown> = {
      channel_id: args.channel_id,
      message: args.message,
      post_at: Math.floor(args.post_at as number),
    };
    assignOptional(mcpArgs, {
      thread_ts: args.thread_ts,
      reply_broadcast: args.reply_broadcast,
    });
    return runSlackTool(toolCtx, "slack_schedule_message", mcpArgs);
  },
});

// ---------------------------------------------------------------------------
// slack_read_channel  (MCP: slack_read_channel)
// ---------------------------------------------------------------------------

export const slackReadChannel = createTool({
  name: "slack_read_channel",
  description:
    "Read messages from a Slack channel in reverse chronological order (newest first). " +
    "Pass a user_id as channel_id to read DM history. Read-only.",
  parameters: {
    type: "object",
    properties: {
      channel_id: {
        type: "string",
        description: "Channel ID (C...), private group, IM, or user ID for DMs.",
      },
      limit: { type: "number", description: "Number of messages (1-100, default 100)." },
      oldest: { type: "string", description: "Start of time range (Slack ts string)." },
      latest: { type: "string", description: "End of time range (Slack ts string)." },
      cursor: { type: "string", description: "Pagination cursor from a previous response." },
      response_format: { type: "string", description: "'detailed' (default) or 'concise'." },
    },
    required: ["channel_id"],
  },
  execute: async (toolCtx, args) => {
    const mcpArgs: Record<string, unknown> = { channel_id: args.channel_id };
    if (typeof args.limit === "number") {
      mcpArgs.limit = Math.max(1, Math.min(args.limit as number, 100));
    }
    assignOptional(mcpArgs, {
      oldest: args.oldest,
      latest: args.latest,
      cursor: args.cursor,
      response_format: args.response_format,
    });
    return runSlackTool(toolCtx, "slack_read_channel", mcpArgs);
  },
});

// ---------------------------------------------------------------------------
// slack_read_thread  (MCP: slack_read_thread)
// ---------------------------------------------------------------------------

export const slackReadThread = createTool({
  name: "slack_read_thread",
  description:
    "Read a full Slack thread (parent message plus all replies). Requires channel_id and " +
    "message_ts of the parent message. Read-only.",
  parameters: {
    type: "object",
    properties: {
      channel_id: { type: "string", description: "Channel ID where the thread lives." },
      message_ts: { type: "string", description: "Timestamp of the parent message (ts value)." },
      limit: { type: "number", description: "Number of messages (1-1000, default 100)." },
      cursor: { type: "string", description: "Pagination cursor." },
      oldest: { type: "string", description: "Start of time range (ts)." },
      latest: { type: "string", description: "End of time range (ts)." },
      response_format: { type: "string", description: "'detailed' (default) or 'concise'." },
    },
    required: ["channel_id", "message_ts"],
  },
  execute: async (toolCtx, args) => {
    const mcpArgs: Record<string, unknown> = {
      channel_id: args.channel_id,
      message_ts: args.message_ts,
    };
    if (typeof args.limit === "number") {
      mcpArgs.limit = Math.max(1, Math.min(args.limit as number, 1000));
    }
    assignOptional(mcpArgs, {
      cursor: args.cursor,
      oldest: args.oldest,
      latest: args.latest,
      response_format: args.response_format,
    });
    return runSlackTool(toolCtx, "slack_read_thread", mcpArgs);
  },
});
