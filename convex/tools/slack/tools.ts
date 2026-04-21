// convex/tools/slack/tools.ts
// =============================================================================
// Slack MCP tool wrappers — aggregator.
//
// Arg schemas verified against Slack's live MCP tools/list response at
// https://mcp.slack.com/mcp (see convex/tools/slack/diagnose.ts). Slack's
// MCP uses:
//   - channel_id  (NOT channel)
//   - message     (NOT text, in send/draft/schedule)
//   - message_ts  (NOT thread_ts, in read_thread)
// and separates message search into slack_search_public vs
// slack_search_public_and_private; NanthAI exposes one stable slack_search_messages
// that routes based on include_private flag.
//
// Implementation split across:
//   - tools_shared.ts    — extractText / assignOptional / runSlackTool
//   - tools_messages.ts  — send / send_draft / schedule / read_channel / read_thread
//   - tools_search.ts    — search_messages / search_channels / search_users
//   - tools_canvas.ts    — create/update/read canvas + read_user_profile
// =============================================================================

export {
  slackSendMessage,
  slackSendMessageDraft,
  slackScheduleMessage,
  slackReadChannel,
  slackReadThread,
} from "./tools_messages";

export {
  slackSearchMessages,
  slackSearchChannels,
  slackSearchUsers,
} from "./tools_search";

export {
  slackCreateCanvas,
  slackUpdateCanvas,
  slackReadCanvas,
  slackReadUserProfile,
} from "./tools_canvas";
