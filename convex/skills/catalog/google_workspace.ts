import { SystemSkillSeedData } from "../mutations_seed";

export const GOOGLE_WORKSPACE_SKILL: SystemSkillSeedData = {
  slug: "google-workspace",
  name: "Google Workspace",
  summary:
    "Work across Gmail, Google Drive, and Google Calendar. Use when the task depends on Google-connected apps or moving information between them.",
  instructionsRaw: `# Google Workspace

Use this skill for tasks that require Gmail, Google Drive, or Google Calendar.

## When to Use

- Read, search, draft, or send Gmail messages
- List, read, move, or upload files in Google Drive
- Check, create, or delete Google Calendar events

## Guidance

- If the user's request clearly names Gmail, Google Drive, or Google Calendar, use that surface directly. Do not ask the user to confirm which Google surface they meant.
- If the user asks to read, list, inspect, or summarize calendar events, call \`google_calendar_list\` directly after loading this skill. Do not ask for confirmation before reading calendar events.
- Treat this skill being visible as a signal that at least one Google integration is enabled for the conversation. If authorization is missing, the tool will return a connection error; then ask the user to reconnect the relevant integration.
- Resolve relative dates such as "last week", "this week", "today", and "tomorrow" from the current date/time context supplied in the system prompt. Use explicit ISO 8601 \`time_min\` and \`time_max\` values for calendar ranges.
- Be explicit when moving data between Gmail, Drive, and Calendar.
- Summarize what changed after each action so the user can verify it quickly.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "integration_managed",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "gmail_send", "gmail_create_draft", "gmail_read", "gmail_search", "gmail_delete", "gmail_modify_labels", "gmail_list_labels",
    "drive_upload", "drive_list", "drive_read", "drive_move",
    "google_calendar_list", "google_calendar_create", "google_calendar_delete",
  ],
  requiredToolProfiles: ["google"],
  requiredIntegrationIds: ["gmail", "drive", "calendar"],
};
