// convex/skills/catalog/prod_calendar_scheduler.ts
// =============================================================================
// System skill: calendar-scheduler
// Original NanthAI skill for calendar management across providers.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const CALENDAR_SCHEDULER_SKILL: SystemSkillSeedData = {
  slug: "calendar-scheduler",
  name: "Calendar Scheduler",
  summary:
    "Manage calendar events — schedule meetings, check availability, set reminders, and " +
    "organize your day. Works with Microsoft Calendar and Apple Calendar.",
  instructionsRaw: `# Calendar Scheduler

Manage calendar events across Microsoft Calendar and Apple Calendar. Schedule meetings, check availability, block focus time, and keep your day organized.

## Available Tools

### Microsoft Calendar (Outlook/365)
- **ms_calendar_list** — List events in a date range
- **ms_calendar_create** — Create a new event
- **ms_calendar_delete** — Delete an event

### Apple Calendar
- **apple_calendar_list** — List events in a date range
- **apple_calendar_create** — Create a new event
- **apple_calendar_update** — Update an existing event
- **apple_calendar_delete** — Delete an event

## When to Use

- Scheduling a meeting and need to check availability first
- Blocking focus time or deep work sessions
- Rescheduling or canceling events
- Getting an overview of today's or this week's schedule
- Finding an open slot for a new meeting
- Organizing a recurring schedule

## Common Workflows

### Schedule a Meeting
1. Ask for: title, attendees, preferred date/time, duration, and which calendar
2. List events for that day to check for conflicts
3. If conflicts exist, suggest alternative times
4. Create the event once confirmed
5. Report back: what was created, when, on which calendar

### Check Availability
1. Ask for the date range to check
2. List events across the relevant calendar(s)
3. Identify free slots (gaps between events, respecting working hours)
4. Present available windows clearly: "You're free 10:00-11:30 and 14:00-16:00"

### Block Focus Time
1. Check the target day for existing commitments
2. Find the largest open blocks
3. Create "Focus Time" or "Do Not Disturb" events in those blocks
4. Confirm what was blocked

### Reschedule an Event
1. List events to find the one being rescheduled
2. Check availability at the new proposed time
3. Delete the old event (or update if Apple Calendar)
4. Create the event at the new time
5. Note: attendees may need to be re-notified manually

### Daily/Weekly Overview
1. List events for the requested period
2. Summarize: number of meetings, total meeting hours, free time blocks
3. Flag potential issues: back-to-back meetings, overloaded days, double-bookings

## Smart Scheduling Guidelines

- **Always check for conflicts before creating.** Never blindly create an event.
- **Respect working hours.** Default to 9:00-18:00 unless the user specifies otherwise.
- **Buffer time matters.** Don't schedule meetings back-to-back. Leave at least 10-15 minutes between meetings when possible.
- **Timezone awareness.** If attendees are in different timezones, note the timezone for each participant and find overlapping working hours.
- **Default duration.** If no duration is specified: 30 minutes for 1:1s, 60 minutes for group meetings.
- **Ask which calendar** if the user has multiple connected calendars and hasn't specified.

## Output Format

### After Scheduling
**Created:** [Event Title]
- **When:** [Day], [Date] at [Time] - [End Time] ([Timezone])
- **Calendar:** [Microsoft / Apple]
- **Duration:** [X] minutes
- **Conflicts:** None found (or list any that were detected)

### Availability Summary
**Availability for [Date]:**
| Time | Status |
|------|--------|
| 09:00 - 10:00 | Busy — "Team Standup" |
| 10:00 - 11:30 | **Free** |
| 11:30 - 12:00 | Busy — "Product Review" |
| 12:00 - 13:00 | **Free** (lunch) |
| 13:00 - 14:30 | Busy — "Client Call" |
| 14:30 - 18:00 | **Free** |

### Daily Overview
**[Day], [Date]**
- [N] meetings, [X] hours of meetings
- Longest free block: [Time] - [Time] ([Y] hours)
- Potential issues: [back-to-back meetings at 2-4pm, double-booking at 3pm, etc.]

## Guidelines

- **Confirm before creating.** Always present the proposed event details and ask for confirmation before calling calendarCreate.
- **One action at a time.** Don't batch-create 5 events without checking each one.
- **Be explicit about which calendar.** Users may have Google for personal and Microsoft for work — don't mix them up.
- **Handle errors gracefully.** If a calendar API fails, tell the user what happened and suggest alternatives.
- **Privacy-aware.** When listing events, don't expose details of events marked as private unless the user specifically asks.

## Quality Checklist

- [ ] Conflicts were checked before creating any event
- [ ] The correct calendar (Microsoft/Apple) was used
- [ ] Event details (title, time, duration) were confirmed with the user
- [ ] Timezone is explicit when relevant
- [ ] Buffer time between meetings was considered
- [ ] The user received a clear confirmation of what was done
- [ ] Any errors or issues were reported clearly`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "integration_managed",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "ms_calendar_list",
    "ms_calendar_create",
    "ms_calendar_delete",
    "apple_calendar_list",
    "apple_calendar_create",
    "apple_calendar_update",
    "apple_calendar_delete",
  ],
  requiredToolProfiles: ["microsoft", "appleCalendar"],
  requiredIntegrationIds: ["ms_calendar", "apple_calendar"],
};
