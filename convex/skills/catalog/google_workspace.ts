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

- Confirm which Google surface you need before taking action.
- Be explicit when moving data between Gmail, Drive, and Calendar.
- Summarize what changed after each action so the user can verify it quickly.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "integration_managed",
  lockState: "locked",
  // Archived per M24: Google scope approval pending. Reinstate when Google integration is re-enabled.
  status: "archived",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "gmail_send", "gmail_read", "gmail_search", "gmail_delete", "gmail_modify_labels", "gmail_list_labels",
    "drive_upload", "drive_list", "drive_read", "drive_move",
    "calendar_list", "calendar_create", "calendar_delete",
  ],
  requiredToolProfiles: ["google"],
  requiredIntegrationIds: ["gmail", "drive", "calendar"],
};
