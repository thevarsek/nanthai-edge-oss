// convex/tools/google/calendar.ts
// =============================================================================
// Google Calendar tools: list events and create new events.
//
// Uses raw `fetch` against https://www.googleapis.com/calendar — no Node.js SDK.
// Tokens are obtained via `getGoogleAccessToken()` which auto-refreshes.
// =============================================================================

import { createTool } from "../registry";
import { getGoogleAccessToken, googleCapabilityToolError } from "./auth";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// ---------------------------------------------------------------------------
// Helper: fetch the user's primary calendar timezone from Google
// ---------------------------------------------------------------------------

async function getUserCalendarTimezone(
  accessToken: string,
): Promise<string | undefined> {
  try {
    const response = await fetch(
      `${CALENDAR_API}/calendars/primary`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return undefined;
    const cal = (await response.json()) as { timeZone?: string };
    return cal.timeZone;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// calendar_list — List upcoming events
// ---------------------------------------------------------------------------

export const calendarList = createTool({
  name: "google_calendar_list",
  description:
    "List upcoming events from the user's Google Calendar. " +
    "Use when the user asks about their schedule, upcoming meetings, " +
    "what's on their calendar, or events for a specific date/range. " +
    "Returns event title, start/end times, location, and description.",
  parameters: {
    type: "object",
    properties: {
      max_results: {
        type: "number",
        description:
          "Maximum number of events to return (default 10, max 50).",
      },
      time_min: {
        type: "string",
        description:
          "Start of time range as ISO 8601 string (optional, defaults to now). " +
          "Example: '2026-03-04T00:00:00Z'.",
      },
      time_max: {
        type: "string",
        description:
          "End of time range as ISO 8601 string (optional). " +
          "Example: '2026-03-11T23:59:59Z'.",
      },
      query: {
        type: "string",
        description:
          "Free text search query to filter events (optional). " +
          "Searches summary, description, location, and attendees.",
      },
    },
    required: [],
  },

  execute: async (toolCtx, args) => {
    const maxResults = Math.min((args.max_results as number) || 10, 50);
    const timeMin =
      (args.time_min as string) || new Date().toISOString();
    const timeMax = args.time_max as string | undefined;
    const query = args.query as string | undefined;

    try {
      const { accessToken } = await getGoogleAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
        "calendar",
      );

      const params = new URLSearchParams({
        maxResults: String(maxResults),
        timeMin,
        singleEvents: "true",
        orderBy: "startTime",
      });
      if (timeMax) params.set("timeMax", timeMax);
      if (query) params.set("q", query);

      const response = await fetch(
        `${CALENDAR_API}/calendars/primary/events?${params.toString()}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Calendar list failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      const result = (await response.json()) as {
        items?: Array<{
          id: string;
          summary?: string;
          description?: string;
          location?: string;
          start?: { dateTime?: string; date?: string; timeZone?: string };
          end?: { dateTime?: string; date?: string; timeZone?: string };
          status?: string;
          htmlLink?: string;
          attendees?: Array<{
            email: string;
            displayName?: string;
            responseStatus?: string;
          }>;
          organizer?: { email?: string; displayName?: string };
        }>;
      };

      const events = (result.items || []).map((e) => ({
        id: e.id,
        summary: e.summary || "(no title)",
        description: e.description
          ? e.description.substring(0, 200)
          : undefined,
        location: e.location,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        isAllDay: !e.start?.dateTime && !!e.start?.date,
        status: e.status,
        htmlLink: e.htmlLink,
        attendees: e.attendees?.map((a) => ({
          email: a.email,
          name: a.displayName,
          status: a.responseStatus,
        })),
        organizer: e.organizer?.email,
      }));

      return {
        success: true,
        data: {
          events,
          resultCount: events.length,
          message:
            events.length > 0
              ? `Found ${events.length} event(s) on the calendar.`
              : "No upcoming events found on the calendar.",
        },
      };
    } catch (e) {
      const capabilityError = googleCapabilityToolError(e);
      if (capabilityError) return capabilityError;
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// calendar_create — Create a new calendar event
// ---------------------------------------------------------------------------

export const calendarCreate = createTool({
  name: "google_calendar_create",
  description:
    "Create a new event on the user's Google Calendar. " +
    "Use when the user asks to schedule a meeting, add an event, " +
    "set a reminder, or create a calendar entry. " +
    "Requires at minimum a title and start/end times. " +
    "IMPORTANT: Always include a timezone offset in ISO times (e.g. '+01:00', '-05:00') " +
    "or pass the 'timezone' parameter. If the user's timezone is unknown, ask them. " +
    "The user's Google Calendar timezone will be used as a fallback.",
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Event title/summary.",
      },
      start_time: {
        type: "string",
        description:
          "Event start time as ISO 8601 string. " +
          "Example: '2026-03-05T14:00:00+01:00'. " +
          "For all-day events use date format: '2026-03-05'.",
      },
      end_time: {
        type: "string",
        description:
          "Event end time as ISO 8601 string. " +
          "Example: '2026-03-05T15:00:00+01:00'. " +
          "For all-day events use date format: '2026-03-06' (day after).",
      },
      description: {
        type: "string",
        description: "Event description/notes (optional).",
      },
      location: {
        type: "string",
        description:
          "Event location — physical address or virtual meeting link (optional).",
      },
      attendees: {
        type: "array",
        description:
          "Email addresses of attendees to invite (optional).",
        items: { type: "string" },
      },
      timezone: {
        type: "string",
        description:
          "IANA timezone for the event (optional, e.g. 'Europe/Rome', 'America/New_York'). " +
          "Defaults to the calendar's timezone if not specified.",
      },
    },
    required: ["summary", "start_time", "end_time"],
  },

  execute: async (toolCtx, args) => {
    const summary = args.summary as string;
    const startTime = args.start_time as string;
    const endTime = args.end_time as string;
    const description = args.description as string | undefined;
    const location = args.location as string | undefined;
    const attendees = args.attendees as string[] | undefined;
    const timezone = args.timezone as string | undefined;

    if (!summary || !startTime || !endTime) {
      return {
        success: false,
        data: null,
        error: "Missing required fields: 'summary', 'start_time', 'end_time'.",
      };
    }

    try {
      const { accessToken } = await getGoogleAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
        "calendar",
      );

      // Resolve timezone: explicit arg > user's Google Calendar timezone
      let effectiveTimezone = timezone;
      if (!effectiveTimezone) {
        effectiveTimezone = await getUserCalendarTimezone(accessToken);
      }

      // Determine if this is an all-day event (date-only vs dateTime)
      const isAllDay =
        /^\d{4}-\d{2}-\d{2}$/.test(startTime) &&
        /^\d{4}-\d{2}-\d{2}$/.test(endTime);

      const eventBody: Record<string, unknown> = {
        summary,
        start: isAllDay
          ? { date: startTime }
          : { dateTime: startTime, timeZone: effectiveTimezone },
        end: isAllDay
          ? { date: endTime }
          : { dateTime: endTime, timeZone: effectiveTimezone },
      };

      if (description) eventBody.description = description;
      if (location) eventBody.location = location;
      if (attendees && attendees.length > 0) {
        eventBody.attendees = attendees.map((email) => ({ email }));
      }

      const response = await fetch(
        `${CALENDAR_API}/calendars/primary/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventBody),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Calendar create failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      const result = (await response.json()) as {
        id: string;
        summary: string;
        htmlLink: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        status: string;
      };

      return {
        success: true,
        data: {
          eventId: result.id,
          summary: result.summary,
          start: result.start?.dateTime || result.start?.date,
          end: result.end?.dateTime || result.end?.date,
          timezone: effectiveTimezone || "calendar default",
          calendarLink: `[View in Google Calendar](${result.htmlLink})`,
          message: `Event "${result.summary}" created successfully.`,
        },
      };
    } catch (e) {
      const capabilityError = googleCapabilityToolError(e);
      if (capabilityError) return capabilityError;
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// calendar_delete — Delete a calendar event
// ---------------------------------------------------------------------------

export const calendarDelete = createTool({
  name: "google_calendar_delete",
  description:
    "Delete an event from the user's Google Calendar. " +
    "Use when the user asks to remove, cancel, or delete a calendar event. " +
    "Requires the event ID, which you can get from google_calendar_list.",
  parameters: {
    type: "object",
    properties: {
      event_id: {
        type: "string",
        description:
          "The Google Calendar event ID to delete. " +
          "Get this from the 'id' field in google_calendar_list results.",
      },
    },
    required: ["event_id"],
  },

  execute: async (toolCtx, args) => {
    const eventId = args.event_id as string;

    if (!eventId) {
      return {
        success: false,
        data: null,
        error: "Missing required field: 'event_id'.",
      };
    }

    try {
      const { accessToken } = await getGoogleAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
        "calendar",
      );

      const response = await fetch(
        `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      // Google returns 204 No Content on successful delete
      if (response.status === 204 || response.ok) {
        return {
          success: true,
          data: {
            eventId,
            message: "Calendar event deleted successfully.",
          },
        };
      }

      // 404 = event not found or already deleted
      if (response.status === 404) {
        return {
          success: false,
          data: null,
          error: "Event not found — it may have already been deleted.",
        };
      }

      // 410 = event already deleted (Gone)
      if (response.status === 410) {
        return {
          success: true,
          data: {
            eventId,
            message: "Event was already deleted.",
          },
        };
      }

      const errorText = await response.text();
      return {
        success: false,
        data: null,
        error: `Calendar delete failed (HTTP ${response.status}): ${errorText}`,
      };
    } catch (e) {
      const capabilityError = googleCapabilityToolError(e);
      if (capabilityError) return capabilityError;
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});
