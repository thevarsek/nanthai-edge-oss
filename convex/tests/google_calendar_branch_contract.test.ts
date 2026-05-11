import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
  calendarCreate,
  calendarDelete,
  calendarList,
} from "../tools/google/calendar";

function googleCalendarCtx(scopes = ["https://www.googleapis.com/auth/calendar.events"]) {
  return {
    userId: "user_1",
    ctx: {
      runQuery: async () => ({
        _id: "google_1",
        userId: "user_1",
        provider: "google",
        accessToken: "google-token",
        refreshToken: "refresh",
        expiresAt: Date.now() + 60 * 60 * 1000,
        scopes,
        status: "active",
        connectedAt: Date.now(),
      }),
    },
  } as any;
}

test("Google Calendar list maps event payloads, clamps limits, and surfaces provider failures", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      if (String(url).includes("q=standup")) {
        return new Response(JSON.stringify({
          items: [
            {
              id: "evt_1",
              summary: "Daily Standup",
              description: "A".repeat(250),
              location: "Zoom",
              start: { dateTime: "2026-05-11T09:00:00Z" },
              end: { dateTime: "2026-05-11T09:15:00Z" },
              status: "confirmed",
              htmlLink: "https://calendar.example/evt_1",
              attendees: [
                { email: "a@example.com", displayName: "A", responseStatus: "accepted" },
              ],
              organizer: { email: "owner@example.com" },
            },
            {
              id: "evt_2",
              start: { date: "2026-05-12" },
              end: { date: "2026-05-13" },
            },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("calendar unavailable", { status: 503 });
    },
  );

  const result = await calendarList.execute(googleCalendarCtx(), {
    max_results: 200,
    time_min: "2026-05-11T00:00:00Z",
    time_max: "2026-05-12T00:00:00Z",
    query: "standup",
  });
  const failed = await calendarList.execute(googleCalendarCtx(), {
    time_min: "2026-05-11T00:00:00Z",
  });

  assert.equal(result.success, true);
  assert.equal((result.data as any).events.length, 2);
  assert.equal((result.data as any).events[0].description.length, 200);
  assert.equal((result.data as any).events[0].organizer, "owner@example.com");
  assert.equal((result.data as any).events[1].summary, "(no title)");
  assert.equal((result.data as any).events[1].isAllDay, true);
  assert.match(requests[0].url, /maxResults=50/);
  assert.match(requests[0].url, /timeMax=2026-05-12T00%3A00%3A00Z/);
  assert.equal(failed.success, false);
  assert.match(String(failed.error), /HTTP 503/);

  fetchMock.mock.restore();
});

test("Google Calendar create handles missing args, all-day events, timezone fallback, and upstream errors", async () => {
  const postedBodies: Array<Record<string, unknown>> = [];
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlText = String(url);
      if (urlText.endsWith("/calendars/primary")) {
        return new Response(JSON.stringify({ timeZone: "Europe/London" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      postedBodies.push(body);
      if (body.summary === "Provider failure") {
        return new Response("quota exceeded", { status: 429 });
      }
      return new Response(JSON.stringify({
        id: `evt_${postedBodies.length}`,
        summary: body.summary,
        htmlLink: "https://calendar.example/new",
        start: (body.start as any),
        end: (body.end as any),
        status: "confirmed",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  );

  const missing = await calendarCreate.execute(googleCalendarCtx(), {});
  const allDay = await calendarCreate.execute(googleCalendarCtx(), {
    summary: "Offsite",
    start_time: "2026-05-12",
    end_time: "2026-05-13",
  });
  const timed = await calendarCreate.execute(googleCalendarCtx(), {
    summary: "Planning",
    start_time: "2026-05-11T10:00:00",
    end_time: "2026-05-11T11:00:00",
    description: "Discuss roadmap",
    location: "Room 1",
    attendees: ["a@example.com", "b@example.com"],
  });
  const failed = await calendarCreate.execute(googleCalendarCtx(), {
    summary: "Provider failure",
    start_time: "2026-05-11T10:00:00",
    end_time: "2026-05-11T11:00:00",
    timezone: "UTC",
  });

  assert.equal(missing.success, false);
  assert.equal(allDay.success, true);
  assert.deepEqual(postedBodies[0].start, { date: "2026-05-12" });
  assert.deepEqual(postedBodies[0].end, { date: "2026-05-13" });
  assert.equal(timed.success, true);
  assert.deepEqual(postedBodies[1].start, {
    dateTime: "2026-05-11T10:00:00",
    timeZone: "Europe/London",
  });
  assert.deepEqual(postedBodies[1].attendees, [
    { email: "a@example.com" },
    { email: "b@example.com" },
  ]);
  assert.equal(failed.success, false);
  assert.match(String(failed.error), /HTTP 429/);

  fetchMock.mock.restore();
});

test("Google Calendar delete covers no-op, deleted, not found, and provider error branches", async () => {
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (url: RequestInfo | URL) => {
      const urlText = String(url);
      if (urlText.endsWith("/gone")) return new Response(null, { status: 410 });
      if (urlText.endsWith("/missing")) return new Response("missing", { status: 404 });
      if (urlText.endsWith("/broken")) return new Response("bad gateway", { status: 502 });
      return new Response(null, { status: 204 });
    },
  );

  const missingArg = await calendarDelete.execute(googleCalendarCtx(), {});
  const deleted = await calendarDelete.execute(googleCalendarCtx(), { event_id: "evt_1" });
  const alreadyGone = await calendarDelete.execute(googleCalendarCtx(), { event_id: "gone" });
  const missing = await calendarDelete.execute(googleCalendarCtx(), { event_id: "missing" });
  const broken = await calendarDelete.execute(googleCalendarCtx(), { event_id: "broken" });

  assert.equal(missingArg.success, false);
  assert.equal(deleted.success, true);
  assert.equal((alreadyGone.data as any).message, "Event was already deleted.");
  assert.equal(missing.success, false);
  assert.match(String(missing.error), /not found/i);
  assert.equal(broken.success, false);
  assert.match(String(broken.error), /HTTP 502/);

  fetchMock.mock.restore();
});

test("Google Calendar tools surface missing capability as a tool-friendly reconnect result", async () => {
  const result = await calendarList.execute(googleCalendarCtx([]), {});

  assert.equal(result.success, false);
  assert.deepEqual(result.data, {
    requiresGoogleCapability: true,
    integrationId: "calendar",
  });
  assert.match(String(result.error), /calendar access is not granted/i);
});
