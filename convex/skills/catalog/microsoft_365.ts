import { SystemSkillSeedData } from "../mutations_seed";

export const MICROSOFT_365_SKILL: SystemSkillSeedData = {
  slug: "microsoft-365",
  name: "Microsoft 365",
  summary:
    "Work across Outlook mail, OneDrive, and Microsoft Calendar. Use when the task depends on Microsoft-connected apps or moving information between them.",
  instructionsRaw: `# Microsoft 365

Use this skill for tasks that require Outlook, OneDrive, or Microsoft Calendar.

## When to Use

- Read, search, draft, or send Outlook messages
- List, read, move, or upload files in OneDrive
- Check, create, or delete Microsoft Calendar events

## Guidance

- Confirm which Microsoft app is relevant before taking action.
- Keep folder, calendar, and mailbox names explicit in the response.
- Summarize state changes after each tool action.
- If Outlook, OneDrive, or Microsoft Calendar read/list tools succeed in the current run, assume the matching action tools are available too when this skill is loaded and the relevant integration is active.
- Do not claim Microsoft 365 action tools are unavailable without first checking whether the needed Outlook, OneDrive, or calendar tool can be called.
- Reuse message IDs, file IDs, folder IDs, and event IDs from earlier Microsoft tool results whenever possible.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "integration_managed",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "outlook_send", "outlook_read", "outlook_search", "outlook_delete", "outlook_move", "outlook_list_folders",
    "onedrive_upload", "onedrive_list", "onedrive_read", "onedrive_move",
    "ms_calendar_list", "ms_calendar_create", "ms_calendar_delete",
  ],
  requiredToolProfiles: ["microsoft"],
  requiredIntegrationIds: ["outlook", "onedrive", "ms_calendar"],
};
