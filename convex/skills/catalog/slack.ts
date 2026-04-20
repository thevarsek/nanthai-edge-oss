import { SystemSkillSeedData } from "../mutations_seed";

export const SLACK_SKILL: SystemSkillSeedData = {
  slug: "slack",
  name: "Slack",
  summary:
    "Search messages, read channels and threads, send messages, manage canvases, and look up users in Slack.",
  instructionsRaw: `# Slack

Use this skill for tasks that require the user's Slack workspace data.

## When to Use

- Search messages, channels, or users in Slack
- Read recent messages from a channel or thread
- Send messages to channels or DMs
- Create, read, or update Slack Canvases
- Look up a user's profile (name, title, email, status, timezone)

## Guidance

- Confirm before sending messages on behalf of the user.
- Summarize search results concisely — Slack messages can be verbose.
- Use slack_search_messages with Slack search modifiers (from:, in:, has:, before:, after:) for precise results.
- Use slack_read_channel to get recent context from a channel before responding.
- Use slack_read_thread to read full conversations before summarizing.
- Some actions require optional scopes the user may not have granted. If a tool returns a missing_scope error, tell the user which permission is needed and ask them to reconnect Slack.
- Channel IDs (C...) are more reliable than channel names for read/send operations.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "integration_managed",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "slack_search_messages",
    "slack_search_users",
    "slack_search_channels",
    "slack_send_message",
    "slack_read_channel",
    "slack_read_thread",
    "slack_create_canvas",
    "slack_update_canvas",
    "slack_read_canvas",
    "slack_read_user_profile",
  ],
  requiredToolProfiles: ["slack"],
  requiredIntegrationIds: ["slack"],
};
