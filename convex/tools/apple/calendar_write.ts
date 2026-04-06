import { createTool } from "../registry";
import { findCalendarById } from "./client";
import {
  buildAppleCalendarEvent,
  updateAppleCalendarEvent,
} from "./ical";
import {
  findAppleCalendarEventByUrl,
  loadAppleCalendars,
  serializeCalendar,
} from "./shared";

export const appleCalendarCreate = createTool({
  name: "apple_calendar_create",
  description:
    "Create a new event on the user's Apple Calendar / iCloud Calendar. " +
    "Requires a title plus start and end times. Date-only values create all-day events.",
  parameters: {
    type: "object",
    properties: {
      calendar_id: {
        type: "string",
        description:
          "Optional Apple calendar ID / URL. Defaults to the first available calendar.",
      },
      summary: {
        type: "string",
        description: "Event title / summary.",
      },
      start_time: {
        type: "string",
        description:
          "Event start as ISO 8601 or YYYY-MM-DD for all-day events.",
      },
      end_time: {
        type: "string",
        description:
          "Event end as ISO 8601 or YYYY-MM-DD for all-day events.",
      },
      description: {
        type: "string",
        description: "Optional event notes.",
      },
      location: {
        type: "string",
        description: "Optional event location.",
      },
      timezone: {
        type: "string",
        description:
          "Optional IANA timezone. Use when start_time/end_time omit an ISO offset.",
      },
    },
    required: ["summary", "start_time", "end_time"],
  },
  execute: async (toolCtx, args) => {
    try {
      const { client, calendars } = await loadAppleCalendars(toolCtx);
      const calendar = findCalendarById(
        calendars,
        args.calendar_id as string | undefined,
      );
      const uid = crypto.randomUUID();
      const filename = `${uid}.ics`;
      const iCalString = buildAppleCalendarEvent({
        uid,
        summary: args.summary as string,
        startTime: args.start_time as string,
        endTime: args.end_time as string,
        description: args.description as string | undefined,
        location: args.location as string | undefined,
        timezone: args.timezone as string | undefined,
      });

      const response = await client.createCalendarObject({
        calendar,
        iCalString,
        filename,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Apple Calendar create failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      return {
        success: true,
        data: {
          eventUrl: new URL(filename, calendar.url).toString(),
          calendar: serializeCalendar(calendar),
          uid,
          message: "Created Apple Calendar event successfully.",
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

export const appleCalendarUpdate = createTool({
  name: "apple_calendar_update",
  description:
    "Update an existing Apple Calendar / iCloud Calendar event. " +
    "Requires the event_url from apple_calendar_list.",
  parameters: {
    type: "object",
    properties: {
      event_url: {
        type: "string",
        description:
          "Apple Calendar event URL from apple_calendar_list results.",
      },
      summary: {
        type: "string",
        description: "Optional updated title / summary.",
      },
      start_time: {
        type: "string",
        description: "Optional updated start as ISO 8601 or YYYY-MM-DD.",
      },
      end_time: {
        type: "string",
        description: "Optional updated end as ISO 8601 or YYYY-MM-DD.",
      },
      description: {
        type: "string",
        description: "Optional updated event notes.",
      },
      location: {
        type: "string",
        description: "Optional updated location.",
      },
      timezone: {
        type: "string",
        description:
          "Optional IANA timezone to use when updated times omit ISO offsets.",
      },
    },
    required: ["event_url"],
  },
  execute: async (toolCtx, args) => {
    const eventUrl = args.event_url as string;

    try {
      const { client, calendars } = await loadAppleCalendars(toolCtx);
      const { event } = await findAppleCalendarEventByUrl(
        client,
        calendars,
        eventUrl,
      );
      event.data = updateAppleCalendarEvent(event.data ?? "", {
        summary: args.summary as string | undefined,
        startTime: args.start_time as string | undefined,
        endTime: args.end_time as string | undefined,
        description: args.description as string | undefined,
        location: args.location as string | undefined,
        timezone: args.timezone as string | undefined,
      });

      const response = await client.updateCalendarObject({
        calendarObject: event,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Apple Calendar update failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      return {
        success: true,
        data: {
          eventUrl,
          message: "Updated Apple Calendar event successfully.",
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

export const appleCalendarDelete = createTool({
  name: "apple_calendar_delete",
  description:
    "Delete an event from the user's Apple Calendar / iCloud Calendar. " +
    "Requires the event_url from apple_calendar_list.",
  parameters: {
    type: "object",
    properties: {
      event_url: {
        type: "string",
        description:
          "Apple Calendar event URL from apple_calendar_list results.",
      },
    },
    required: ["event_url"],
  },
  execute: async (toolCtx, args) => {
    const eventUrl = args.event_url as string;

    try {
      const { client, calendars } = await loadAppleCalendars(toolCtx);
      const { event } = await findAppleCalendarEventByUrl(
        client,
        calendars,
        eventUrl,
      );
      const response = await client.deleteCalendarObject({
        calendarObject: event,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Apple Calendar delete failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      return {
        success: true,
        data: {
          eventUrl,
          message: "Deleted Apple Calendar event successfully.",
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
