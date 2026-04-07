import assert from "node:assert/strict";
import test from "node:test";

import { getAppleCalendarCredentials } from "../tools/apple/auth";
import { findCalendarById } from "../tools/apple/client";
import {
  buildAppleCalendarEvent,
  parseAppleCalendarEvent,
  updateAppleCalendarEvent,
} from "../tools/apple/ical";
import {
  findAppleCalendarEventByUrl,
  selectAppleCalendars,
  serializeCalendar,
  serializeEvent,
} from "../tools/apple/shared";

test("getAppleCalendarCredentials returns app-specific credentials and validates connection state", async () => {
  const credentials = await getAppleCalendarCredentials({
    runQuery: async () => ({
      _id: "apple_1",
      userId: "user_1",
      provider: "apple_calendar",
      accessToken: "app_specific_password",
      refreshToken: "",
      expiresAt: 0,
      scopes: [],
      email: "user@icloud.com",
      status: "active",
      connectedAt: 1,
    }),
  } as any, "user_1");

  assert.equal(credentials.username, "user@icloud.com");
  assert.equal(credentials.appSpecificPassword, "app_specific_password");

  await assert.rejects(
    () =>
      getAppleCalendarCredentials({
        runQuery: async () => ({
          _id: "apple_1",
          userId: "user_1",
          provider: "apple_calendar",
          accessToken: "token",
          refreshToken: "",
          expiresAt: 0,
          scopes: [],
          status: "expired",
          connectedAt: 1,
        }),
      } as any, "user_1"),
    /Apple Calendar connection is expired/,
  );

  await assert.rejects(
    () =>
      getAppleCalendarCredentials({
        runQuery: async () => ({
          _id: "apple_1",
          userId: "user_1",
          provider: "apple_calendar",
          accessToken: "",
          refreshToken: "",
          expiresAt: 0,
          scopes: [],
          email: "user@icloud.com",
          status: "active",
          connectedAt: 1,
        }),
      } as any, "user_1"),
    /Apple Calendar credentials are incomplete/,
  );
});

test("buildAppleCalendarEvent and parseAppleCalendarEvent round-trip timed events with escaping", () => {
  const raw = buildAppleCalendarEvent({
    uid: "event_1",
    summary: "Design review, planning",
    description: "Line 1\nLine 2; bring notes",
    location: "Room A; Floor 5",
    startTime: "2026-05-02T09:00:00",
    endTime: "2026-05-02T10:30:00",
    timezone: "Europe/London",
  });

  const parsed = parseAppleCalendarEvent(raw);
  assert.equal(parsed.uid, "event_1");
  assert.equal(parsed.summary, "Design review, planning");
  assert.equal(parsed.description, "Line 1\nLine 2; bring notes");
  assert.equal(parsed.location, "Room A; Floor 5");
  assert.equal(parsed.start, "2026-05-02T09:00:00");
  assert.equal(parsed.startTimezone, "Europe/London");
  assert.equal(parsed.end, "2026-05-02T10:30:00");
  assert.equal(parsed.endTimezone, "Europe/London");
  assert.equal(parsed.isAllDay, false);
  assert.equal(parsed.sequence, 0);
});

test("parseAppleCalendarEvent recognizes all-day events", () => {
  const raw = buildAppleCalendarEvent({
    uid: "event_2",
    summary: "Company holiday",
    startTime: "2026-12-25",
    endTime: "2026-12-26",
  });

  const parsed = parseAppleCalendarEvent(raw);
  assert.equal(parsed.start, "2026-12-25");
  assert.equal(parsed.end, "2026-12-26");
  assert.equal(parsed.isAllDay, true);
  assert.equal(parsed.startTimezone, undefined);
});

test("updateAppleCalendarEvent replaces managed fields, increments sequence, and preserves custom lines", () => {
  const original = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:event_3",
    "DTSTAMP:20260401T100000Z",
    "LAST-MODIFIED:20260401T100000Z",
    "SEQUENCE:0",
    "SUMMARY:Old title",
    "DESCRIPTION:Old description",
    "LOCATION:Old room",
    "DTSTART;TZID=Europe/London:20260502T090000",
    "DTEND;TZID=Europe/London:20260502T100000",
    "X-CUSTOM:keep-me",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

  const updated = updateAppleCalendarEvent(original, {
    summary: "New title",
    description: "Updated description",
    startTime: "2026-05-02T11:00:00",
    endTime: "2026-05-02T12:00:00",
    timezone: "Europe/London",
  });
  const parsed = parseAppleCalendarEvent(updated);

  assert.match(updated, /SEQUENCE:1/);
  assert.match(updated, /X-CUSTOM:keep-me/);
  assert.equal(parsed.summary, "New title");
  assert.equal(parsed.description, "Updated description");
  assert.equal(parsed.start, "2026-05-02T11:00:00");
  assert.equal(parsed.end, "2026-05-02T12:00:00");
});

test("updateAppleCalendarEvent rejects invalid source events and missing timezone information", () => {
  assert.throws(
    () => updateAppleCalendarEvent("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", {
      summary: "Broken",
    }),
    /could not be parsed/,
  );

  const original = buildAppleCalendarEvent({
    uid: "event_4",
    summary: "Timezone required",
    startTime: "2026-06-01T09:00:00+00:00",
    endTime: "2026-06-01T10:00:00+00:00",
  });

  assert.throws(
    () =>
      updateAppleCalendarEvent(original, {
        startTime: "2026-06-01T09:00:00",
        endTime: "2026-06-01T10:00:00",
        timezone: "",
      }),
    /requires either an ISO offset or a timezone/,
  );
});

test("apple calendar helpers normalize calendars, select ids, and locate events by url", async () => {
  const calendars = [
    {
      url: "cal_1",
      displayName: "Work",
      timezone: "Europe/London",
      calendarColor: "#00AAFF",
    },
    {
      url: "cal_2",
      displayName: "Home",
      timezone: "Europe/Paris",
      calendarColor: "#33CC66",
    },
  ] as any[];
  const rawEvent = buildAppleCalendarEvent({
    uid: "event_5",
    summary: "Lunch",
    startTime: "2026-06-10T12:00:00+00:00",
    endTime: "2026-06-10T13:00:00+00:00",
    location: "Cafe",
  });

  assert.deepEqual(serializeCalendar(calendars[0]), {
    id: "cal_1",
    name: "Work",
    timezone: "Europe/London",
    color: "#00AAFF",
  });
  assert.deepEqual(selectAppleCalendars(calendars as any), calendars);
  assert.equal(findCalendarById(calendars as any, "cal_2").displayName, "Home");
  assert.deepEqual(selectAppleCalendars(calendars as any, "cal_1"), [calendars[0]]);

  const found = await findAppleCalendarEventByUrl(
    {
      fetchCalendarObjects: async ({ calendar }: { calendar: { url: string } }) =>
        calendar.url === "cal_2"
          ? [{ url: "event_url", etag: "etag_1", data: rawEvent }]
          : [],
    } as any,
    calendars as any,
    "event_url",
  );

  assert.equal(found.calendar.url, "cal_2");
  assert.deepEqual(serializeEvent(found.calendar as any, found.event as any), {
    eventUrl: "event_url",
    calendarId: "cal_2",
    calendarName: "Home",
    uid: "event_5",
    summary: "Lunch",
    description: undefined,
    location: "Cafe",
    start: "2026-06-10T12:00:00Z",
    startTimezone: undefined,
    end: "2026-06-10T13:00:00Z",
    endTimezone: undefined,
    isAllDay: false,
    etag: "etag_1",
  });

  await assert.rejects(
    () => findAppleCalendarEventByUrl(
      {
        fetchCalendarObjects: async () => [],
      } as any,
      calendars as any,
      "missing_event",
    ),
    /was not found/,
  );

  assert.throws(
    () => findCalendarById([] as any, undefined),
    /No Apple calendars are available/,
  );
});
