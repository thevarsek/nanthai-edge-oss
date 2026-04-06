import { createTool } from "../registry";
import {
  loadAppleCalendars,
  selectAppleCalendars,
  serializeCalendar,
  serializeEvent,
} from "./shared";

export const appleCalendarList = createTool({
  name: "apple_calendar_list",
  description:
    "List events from the user's Apple Calendar / iCloud Calendar. " +
    "Use when the user asks about their Apple schedule, iCloud calendar events, " +
    "or needs event IDs/URLs for later updates or deletion.",
  parameters: {
    type: "object",
    properties: {
      calendar_id: {
        type: "string",
        description:
          "Optional Apple calendar ID / URL. Omit to search across all calendars.",
      },
      max_results: {
        type: "number",
        description: "Maximum number of events to return (default 10, max 50).",
      },
      time_min: {
        type: "string",
        description: "Optional ISO 8601 start time. Defaults to now.",
      },
      time_max: {
        type: "string",
        description:
          "Optional ISO 8601 end time. Defaults to 30 days after time_min.",
      },
      query: {
        type: "string",
        description:
          "Optional case-insensitive text filter applied to event title, description, and location.",
      },
    },
    required: [],
  },
  execute: async (toolCtx, args) => {
    const maxResults = Math.min((args.max_results as number) || 10, 50);
    const timeMin = (args.time_min as string) || new Date().toISOString();
    const timeMax = (args.time_max as string)
      || new Date(
        Date.parse(timeMin) + 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
    const query = ((args.query as string) || "").trim().toLowerCase();
    const calendarId = args.calendar_id as string | undefined;

    try {
      const { client, calendars } = await loadAppleCalendars(toolCtx);
      const targetCalendars = selectAppleCalendars(calendars, calendarId);

      const objectsByCalendar = await Promise.all(
        targetCalendars.map(async (calendar) => ({
          calendar,
          objects: await client.fetchCalendarObjects({
            calendar,
            timeRange: { start: timeMin, end: timeMax },
            expand: true,
          }),
        })),
      );

      const events = objectsByCalendar
        .flatMap(({ calendar, objects }) =>
          objects.map((event) => serializeEvent(calendar, event)),
        )
        .filter((event) => {
          if (!query) return true;
          const haystack = [
            event.summary,
            event.description,
            event.location,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        })
        .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""))
        .slice(0, maxResults);

      return {
        success: true,
        data: {
          calendars: targetCalendars.map(serializeCalendar),
          events,
          resultCount: events.length,
          message:
            events.length > 0
              ? `Found ${events.length} Apple Calendar event(s).`
              : "No Apple Calendar events were found for that range.",
        },
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
