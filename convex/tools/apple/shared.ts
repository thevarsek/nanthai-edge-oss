import { ConvexError } from "convex/values";
import type { DAVCalendar, DAVCalendarObject } from "tsdav";
import type { ToolExecutionContext } from "../registry";
import { getAppleCalendarCredentials } from "./auth";
import { createAppleCalendarClient, findCalendarById } from "./client";
import { parseAppleCalendarEvent } from "./ical";

export type AppleCalendarClient = Awaited<
  ReturnType<typeof createAppleCalendarClient>
>;

export function serializeCalendar(calendar: DAVCalendar) {
  return {
    id: calendar.url,
    name:
      typeof calendar.displayName === "string"
        ? calendar.displayName
        : undefined,
    timezone: calendar.timezone,
    color: calendar.calendarColor,
  };
}

export function serializeEvent(
  calendar: DAVCalendar,
  event: DAVCalendarObject,
) {
  const parsed = parseAppleCalendarEvent(event.data ?? "");
  return {
    eventUrl: event.url,
    calendarId: calendar.url,
    calendarName:
      typeof calendar.displayName === "string"
        ? calendar.displayName
        : undefined,
    uid: parsed.uid,
    summary: parsed.summary ?? "(no title)",
    description: parsed.description,
    location: parsed.location,
    start: parsed.start,
    startTimezone: parsed.startTimezone,
    end: parsed.end,
    endTimezone: parsed.endTimezone,
    isAllDay: parsed.isAllDay,
    etag: event.etag,
  };
}

export async function loadAppleCalendars(toolCtx: ToolExecutionContext) {
  const credentials = await getAppleCalendarCredentials(
    toolCtx.ctx,
    toolCtx.userId,
  );
  const client = await createAppleCalendarClient({
    username: credentials.username,
    appSpecificPassword: credentials.appSpecificPassword,
  });

  const calendars = (await client.fetchCalendars()).filter((calendar) => {
    if (!calendar.url) return false;
    if (!calendar.components || calendar.components.length === 0) return true;
    return calendar.components.includes("VEVENT");
  });

  if (calendars.length === 0) {
    throw new ConvexError({
      code: "NOT_FOUND" as const,
      message: "No Apple calendars were found for this account.",
    });
  }

  return { client, calendars };
}

export function selectAppleCalendars(
  calendars: DAVCalendar[],
  calendarId?: string,
): DAVCalendar[] {
  if (!calendarId) {
    return calendars;
  }
  return [findCalendarById(calendars, calendarId)];
}

export async function findAppleCalendarEventByUrl(
  client: AppleCalendarClient,
  calendars: DAVCalendar[],
  eventUrl: string,
): Promise<{ calendar: DAVCalendar; event: DAVCalendarObject }> {
  for (const calendar of calendars) {
    const objects = await client.fetchCalendarObjects({
      calendar,
      objectUrls: [eventUrl],
      useMultiGet: true,
    });
    const event = objects[0];
    if (event) {
      return { calendar, event };
    }
  }

  throw new ConvexError({
    code: "NOT_FOUND" as const,
    message: `Apple Calendar event '${eventUrl}' was not found for this account.`,
  });
}
