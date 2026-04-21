// convex/tools/slack/mcp_tools_snapshot.ts
// =============================================================================
// Baseline snapshot of Slack's MCP tools/list response.
// Captured from https://mcp.slack.com/mcp at the time the Slack integration
// landed. The drift_check cron compares the live response to this baseline
// and logs a warning if Slack changes tool names or required/optional args.
//
// REGENERATE AFTER CONFIRMED SLACK MCP CHANGES:
//   CONVEX_URL=<your-dev-deployment-url> \
//     npx convex run tools/slack/diagnose:listSlackMcpTools '{"userId":"<USER>"}' \
//     > /tmp/slack_tools.json
//   # then manually update this file with the new required + property keys.
// =============================================================================

export interface SlackMcpToolShape {
  /** MCP tool name, e.g. "slack_send_message". */
  name: string;
  /** Required input arg names (sorted). */
  required: string[];
  /** All input arg names, required + optional (sorted). */
  properties: string[];
}

export const SLACK_MCP_TOOLS_SNAPSHOT: SlackMcpToolShape[] = [
  {
    name: "slack_send_message",
    required: ["channel_id", "message"],
    properties: ["channel_id", "message", "reply_broadcast", "thread_ts"],
  },
  {
    name: "slack_send_message_draft",
    required: ["channel_id", "message"],
    properties: ["channel_id", "message", "thread_ts"],
  },
  {
    name: "slack_schedule_message",
    required: ["channel_id", "message", "post_at"],
    properties: ["channel_id", "message", "post_at", "reply_broadcast", "thread_ts"],
  },
  {
    name: "slack_read_channel",
    required: ["channel_id"],
    properties: ["channel_id", "cursor", "latest", "limit", "oldest", "response_format"],
  },
  {
    name: "slack_read_thread",
    required: ["channel_id", "message_ts"],
    properties: [
      "channel_id",
      "cursor",
      "latest",
      "limit",
      "message_ts",
      "oldest",
      "response_format",
    ],
  },
  {
    name: "slack_search_public",
    required: ["query"],
    properties: [
      "after",
      "before",
      "content_types",
      "context_channel_id",
      "cursor",
      "include_bots",
      "include_context",
      "limit",
      "max_context_length",
      "query",
      "response_format",
      "sort",
      "sort_dir",
    ],
  },
  {
    name: "slack_search_public_and_private",
    required: ["query"],
    properties: [
      "after",
      "before",
      "channel_types",
      "content_types",
      "context_channel_id",
      "cursor",
      "include_bots",
      "include_context",
      "limit",
      "max_context_length",
      "query",
      "response_format",
      "sort",
      "sort_dir",
    ],
  },
  {
    name: "slack_search_channels",
    required: ["query"],
    properties: [
      "channel_types",
      "cursor",
      "include_archived",
      "limit",
      "query",
      "response_format",
    ],
  },
  {
    name: "slack_search_users",
    required: ["query"],
    properties: ["cursor", "limit", "query", "response_format"],
  },
  {
    name: "slack_create_canvas",
    required: ["content", "title"],
    properties: ["content", "title"],
  },
  {
    name: "slack_update_canvas",
    required: ["action", "canvas_id", "content"],
    properties: ["action", "canvas_id", "content", "section_id"],
  },
  {
    name: "slack_read_canvas",
    required: ["canvas_id"],
    properties: ["canvas_id"],
  },
  {
    name: "slack_read_user_profile",
    required: [],
    properties: ["include_locale", "response_format", "user_id"],
  },
];
