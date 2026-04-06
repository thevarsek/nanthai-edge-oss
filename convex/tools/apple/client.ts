import type { DAVCalendar } from "tsdav";
import { createDAVClient } from "tsdav";

const ICLOUD_CALDAV_SERVER_URL = "https://caldav.icloud.com";

export interface AppleCalendarCredentials {
  username: string;
  appSpecificPassword: string;
}

export interface AppleCalendarSummary {
  id: string;
  displayName?: string;
  timezone?: string;
  color?: string;
}

export async function createAppleCalendarClient(
  credentials: AppleCalendarCredentials,
) {
  return await createDAVClient({
    serverUrl: ICLOUD_CALDAV_SERVER_URL,
    credentials: {
      username: credentials.username,
      password: credentials.appSpecificPassword,
    },
    authMethod: "Basic",
    defaultAccountType: "caldav",
    fetch,
  });
}

export async function discoverCalendarsForCredentials(
  credentials: AppleCalendarCredentials,
): Promise<DAVCalendar[]> {
  const client = await createAppleCalendarClient(credentials);
  const calendars = await client.fetchCalendars();
  return calendars.filter((calendar) => {
    if (!calendar.url) return false;
    if (!calendar.components || calendar.components.length === 0) return true;
    return calendar.components.includes("VEVENT");
  });
}

export async function discoverAppleCalendars(
  credentials: AppleCalendarCredentials,
): Promise<AppleCalendarSummary[]> {
  const calendars = await discoverCalendarsForCredentials(credentials);
  return calendars.map((calendar) => ({
    id: calendar.url,
    displayName:
      typeof calendar.displayName === "string"
        ? calendar.displayName
        : undefined,
    timezone: calendar.timezone,
    color: calendar.calendarColor,
  }));
}

export function findCalendarById(
  calendars: DAVCalendar[],
  calendarId?: string,
): DAVCalendar {
  if (calendars.length === 0) {
    throw new Error("No Apple calendars are available for this account.");
  }

  if (!calendarId) {
    return calendars[0];
  }

  const calendar = calendars.find((entry) => entry.url === calendarId);
  if (!calendar) {
    throw new Error(
      `Apple Calendar '${calendarId}' was not found for this account.`,
    );
  }
  return calendar;
}
