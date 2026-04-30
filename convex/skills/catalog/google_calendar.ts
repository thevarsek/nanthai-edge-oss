import { SystemSkillSeedData } from "../mutations_seed";

// Archived: Google Calendar is currently exposed through google-workspace.
export const GOOGLE_CALENDAR_SKILL: SystemSkillSeedData = {
  slug: "google-calendar",
  name: "Google Calendar",
  summary:
    "Check, create, and delete Google Calendar events when the task depends on the user's schedule.",
  instructionsRaw: `# Google Calendar

Use this skill for tasks that require Google Calendar.

## When to Use

- Check upcoming events or availability
- Create calendar events
- Delete or cancel events

## Guidance

- Confirm dates, times, and timezone-sensitive details before changing events.
- Resolve relative dates such as "today", "tomorrow", "this week", and "last week" from the current date/time context supplied in the system prompt. Use explicit ISO 8601 ranges for Calendar listing tools.
- Summarize what was created or removed so the user can verify it quickly.
- If Calendar listing succeeds in the current run, assume Calendar action tools are available too when this skill is loaded and the Calendar integration is active.
- Do not claim Calendar action tools are unavailable without first checking whether the needed Calendar tool can be called.
- Reuse event IDs and earlier event details from previous Calendar tool results whenever possible.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "integration_managed",
  lockState: "locked",
  status: "archived",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "google_calendar_list",
    "google_calendar_create",
    "google_calendar_delete",
  ],
  requiredToolProfiles: ["google"],
  requiredIntegrationIds: ["calendar"],
};
