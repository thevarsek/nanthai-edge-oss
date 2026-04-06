// convex/tools/microsoft/calendar.ts
// =============================================================================
// Microsoft Calendar tools: list events, create events, and delete events
// via Microsoft Graph.
//
// Uses raw `fetch` against https://graph.microsoft.com/v1.0 — no Node.js SDK.
// Tokens are obtained via `getMicrosoftAccessToken()` which auto-refreshes.
// =============================================================================

import { createTool } from "../registry";
import { getMicrosoftAccessToken } from "./auth";

const GRAPH_API = "https://graph.microsoft.com/v1.0/me";

function escapeODataStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

// ---------------------------------------------------------------------------
// Helper: fetch the user's mailbox timezone from Microsoft Graph
// ---------------------------------------------------------------------------

async function getUserMailboxTimezone(
  accessToken: string,
): Promise<string | undefined> {
  try {
    const response = await fetch(`${GRAPH_API}/mailboxSettings/timeZone`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { value?: string };
    return data.value;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// ms_calendar_list — List upcoming events
// ---------------------------------------------------------------------------

export const msCalendarList = createTool({
  name: "ms_calendar_list",
  description:
    "List upcoming events from the user's Microsoft Outlook Calendar. " +
    "Use when the user asks about their schedule, upcoming meetings, " +
    "what's on their Outlook/Microsoft calendar, or events for a specific date/range. " +
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
          "Searches subject and body.",
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
      const { accessToken } = await getMicrosoftAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      // Use calendarView for time-range queries (expands recurring events)
      // or events endpoint for general listing
      let url: string;
      if (timeMax) {
        // calendarView requires both startDateTime and endDateTime
        const params = new URLSearchParams({
          startDateTime: timeMin,
          endDateTime: timeMax,
          $top: String(maxResults),
          $select:
            "id,subject,bodyPreview,start,end,location,isAllDay,organizer,attendees,webLink,isCancelled",
          $orderby: "start/dateTime",
        });
        if (query) {
          params.set(
            "$filter",
            `contains(subject,'${escapeODataStringLiteral(query)}')`,
          );
        }
        url = `${GRAPH_API}/calendarView?${params.toString()}`;
      } else {
        // List upcoming events
        const params = new URLSearchParams({
          $top: String(maxResults),
          $select:
            "id,subject,bodyPreview,start,end,location,isAllDay,organizer,attendees,webLink,isCancelled",
          $orderby: "start/dateTime",
          $filter: `start/dateTime ge '${timeMin}'`,
        });
        url = `${GRAPH_API}/events?${params.toString()}`;
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: `outlook.timezone="UTC"`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Calendar list failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        value?: Array<{
          id: string;
          subject?: string;
          bodyPreview?: string;
          start?: { dateTime?: string; timeZone?: string };
          end?: { dateTime?: string; timeZone?: string };
          location?: { displayName?: string };
          isAllDay?: boolean;
          isCancelled?: boolean;
          webLink?: string;
          organizer?: {
            emailAddress?: { name?: string; address?: string };
          };
          attendees?: Array<{
            emailAddress?: { name?: string; address?: string };
            status?: { response?: string };
          }>;
        }>;
      };

      const events = (data.value || []).map((e) => ({
        id: e.id,
        summary: e.subject || "(no title)",
        description: e.bodyPreview
          ? e.bodyPreview.substring(0, 200)
          : undefined,
        location: e.location?.displayName,
        start: e.start?.dateTime,
        startTimezone: e.start?.timeZone,
        end: e.end?.dateTime,
        endTimezone: e.end?.timeZone,
        isAllDay: e.isAllDay ?? false,
        isCancelled: e.isCancelled ?? false,
        webLink: e.webLink,
        organizer: e.organizer?.emailAddress?.address,
        attendees: e.attendees?.map((a) => ({
          email: a.emailAddress?.address,
          name: a.emailAddress?.name,
          status: a.status?.response,
        })),
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
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// ms_calendar_create — Create a new calendar event
// ---------------------------------------------------------------------------

export const msCalendarCreate = createTool({
  name: "ms_calendar_create",
  description:
    "Create a new event on the user's Microsoft Outlook Calendar. " +
    "Use when the user asks to schedule a meeting, add an event, " +
    "set a reminder, or create a calendar entry via their Microsoft account. " +
    "Requires at minimum a title and start/end times. " +
    "IMPORTANT: Always include a timezone in the 'timezone' parameter " +
    "or use ISO times with timezone offsets. If the user's timezone is unknown, ask them. " +
    "The user's Outlook mailbox timezone will be used as a fallback.",
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
          "Example: '2026-03-05T14:00:00'. " +
          "For all-day events use date format: '2026-03-05'.",
      },
      end_time: {
        type: "string",
        description:
          "Event end time as ISO 8601 string. " +
          "Example: '2026-03-05T15:00:00'. " +
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
          "Windows timezone name for the event (optional, e.g. 'Eastern Standard Time', " +
          "'Pacific Standard Time', 'W. Europe Standard Time'). " +
          "Defaults to the user's mailbox timezone if not specified.",
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
      const { accessToken } = await getMicrosoftAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      // Resolve timezone: explicit arg > user's mailbox timezone > UTC
      let effectiveTimezone = timezone;
      if (!effectiveTimezone) {
        effectiveTimezone = await getUserMailboxTimezone(accessToken);
      }
      if (!effectiveTimezone) {
        effectiveTimezone = "UTC";
      }

      // Determine if this is an all-day event
      const isAllDay =
        /^\d{4}-\d{2}-\d{2}$/.test(startTime) &&
        /^\d{4}-\d{2}-\d{2}$/.test(endTime);

      const eventBody: Record<string, unknown> = {
        subject: summary,
        start: {
          dateTime: isAllDay ? `${startTime}T00:00:00` : startTime,
          timeZone: effectiveTimezone,
        },
        end: {
          dateTime: isAllDay ? `${endTime}T00:00:00` : endTime,
          timeZone: effectiveTimezone,
        },
        isAllDay,
      };

      if (description) {
        eventBody.body = { contentType: "Text", content: description };
      }
      if (location) {
        eventBody.location = { displayName: location };
      }
      if (attendees && attendees.length > 0) {
        eventBody.attendees = attendees.map((email) => ({
          emailAddress: { address: email },
          type: "required",
        }));
      }

      const response = await fetch(`${GRAPH_API}/events`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventBody),
      });

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
        subject: string;
        webLink?: string;
        start?: { dateTime?: string; timeZone?: string };
        end?: { dateTime?: string; timeZone?: string };
      };

      return {
        success: true,
        data: {
          eventId: result.id,
          summary: result.subject,
          start: result.start?.dateTime,
          end: result.end?.dateTime,
          timezone: effectiveTimezone,
          calendarLink: result.webLink
            ? `[View in Outlook Calendar](${result.webLink})`
            : undefined,
          message: `Event "${result.subject}" created successfully.`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// ms_calendar_delete — Delete a calendar event
// ---------------------------------------------------------------------------

export const msCalendarDelete = createTool({
  name: "ms_calendar_delete",
  description:
    "Delete an event from the user's Microsoft Outlook Calendar. " +
    "Use when the user asks to remove, cancel, or delete a calendar event. " +
    "Requires the event ID, which you can get from ms_calendar_list.",
  parameters: {
    type: "object",
    properties: {
      event_id: {
        type: "string",
        description:
          "The Microsoft Calendar event ID to delete. " +
          "Get this from the 'id' field in ms_calendar_list results.",
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
      const { accessToken } = await getMicrosoftAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      const response = await fetch(
        `${GRAPH_API}/events/${encodeURIComponent(eventId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      // Microsoft returns 204 No Content on successful delete
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

      const errorText = await response.text();
      return {
        success: false,
        data: null,
        error: `Calendar delete failed (HTTP ${response.status}): ${errorText}`,
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});
