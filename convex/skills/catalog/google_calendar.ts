import { SystemSkillSeedData } from "../mutations_seed";

// Archived: Calendar Scheduler skill now covers Google Calendar as a unified
// cross-provider skill. Additionally paused per M24 (Google scope approval pending).
// Reinstate when Google integration is re-enabled and if a standalone skill is needed.
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
