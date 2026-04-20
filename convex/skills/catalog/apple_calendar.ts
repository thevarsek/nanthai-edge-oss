import { SystemSkillSeedData } from "../mutations_seed";

// Archived: Calendar Scheduler skill now covers Apple Calendar as a unified
// cross-provider skill. Kept in seed catalog so upsert archives the DB record.
// Reinstate as a standalone skill only if there is a clear token-savings need.
export const APPLE_CALENDAR_SKILL: SystemSkillSeedData = {
  slug: "apple-calendar",
  name: "Apple Calendar",
  summary:
    "Manage Apple Calendar events. Use when the task needs iCloud/Apple Calendar scheduling, availability checks, or event updates.",
  instructionsRaw: `# Apple Calendar

Use this skill for Apple Calendar tasks.

## When to Use

- Check events in a date range
- Create, update, or delete Apple Calendar events
- Review availability before proposing a meeting time

## Guidance

- Check for conflicts before creating or updating an event.
- Make the target time and calendar context explicit.
- Summarize the event details after each successful change.
- If Apple Calendar listing succeeds in the current run, assume Apple Calendar action tools are available too when this skill is loaded and the Apple Calendar integration is active.
- Do not claim Apple Calendar action tools are unavailable without first checking whether the needed Apple Calendar tool can be called.
- Reuse event IDs and earlier event details from previous Apple Calendar tool results whenever possible.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "integration_managed",
  lockState: "locked",
  status: "archived",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "apple_calendar_list",
    "apple_calendar_create",
    "apple_calendar_update",
    "apple_calendar_delete",
  ],
  requiredToolProfiles: ["appleCalendar"],
  requiredIntegrationIds: ["apple_calendar"],
};
