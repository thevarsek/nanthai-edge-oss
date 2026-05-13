import assert from "node:assert/strict";
import test from "node:test";

import {
  msCalendarCreate,
  msCalendarDelete,
  msCalendarList,
} from "../tools/microsoft/calendar";

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as any;
}

function textResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => {
      throw new Error("invalid json");
    },
    text: async () => body,
  } as any;
}

function createMicrosoftToolCtx() {
  return {
    userId: "user_1",
    ctx: {
      runQuery: async () => ({
        _id: "ms_1",
        userId: "user_1",
        provider: "microsoft",
        accessToken: "ms_token",
        refreshToken: "refresh_1",
        expiresAt: Date.now() + 60 * 60 * 1000,
        scopes: ["Calendars.ReadWrite"],
        status: "active",
        connectedAt: 1,
      }),
      runMutation: async () => undefined,
    },
  } as any;
}

test("Microsoft calendar list uses event endpoint defaults and handles empty/error responses", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  let callIndex = 0;

  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    callIndex += 1;
    if (callIndex === 1) {
      return jsonResponse(200, {
        value: [{
          id: "event_1",
          subject: "",
          bodyPreview: "Preview text",
          location: {},
          attendees: [{ emailAddress: { name: "Ada" }, status: {} }],
        }],
      });
    }
    if (callIndex === 2) return jsonResponse(200, {});
    if (callIndex === 3) return textResponse(503, "calendar unavailable");
    throw new Error(`Unexpected fetch ${callIndex}`);
  }) as any;

  try {
    const listed = await msCalendarList.execute(createMicrosoftToolCtx(), {
      max_results: 99,
      time_min: "2026-05-13T00:00:00Z",
    });
    const empty = await msCalendarList.execute(createMicrosoftToolCtx(), {
      time_min: "2026-05-14T00:00:00Z",
    });
    const failed = await msCalendarList.execute(createMicrosoftToolCtx(), {
      time_min: "2026-05-15T00:00:00Z",
    });

    assert.equal(listed.success, true);
    assert.match(decodeURIComponent(requests[0]!), /\/events\?/);
    assert.match(decodeURIComponent(requests[0]!), /\$top=50/);
    assert.equal((listed.data as any).events[0].summary, "(no title)");
    assert.equal((listed.data as any).events[0].description, "Preview text");
    assert.deepEqual((listed.data as any).events[0].attendees, [{
      email: undefined,
      name: "Ada",
      status: undefined,
    }]);
    assert.equal(empty.success, true);
    assert.equal((empty.data as any).resultCount, 0);
    assert.match(String((empty.data as any).message), /No upcoming/);
    assert.equal(failed.success, false);
    assert.match(String(failed.error), /503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Microsoft calendar create validates input, applies explicit timezone, and maps provider failures", async () => {
  const missing = await msCalendarCreate.execute(createMicrosoftToolCtx(), {
    summary: "Review",
    start_time: "",
    end_time: "2026-05-13T10:00:00",
  });
  assert.equal(missing.success, false);

  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  let callIndex = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/mailboxSettings/timeZone")) {
      return textResponse(500, "timezone unavailable");
    }
    callIndex += 1;
    bodies.push(JSON.parse(String(init?.body)));
    if (callIndex === 1) {
      return jsonResponse(201, {
        id: "event_2",
        subject: "Review",
        start: { dateTime: "2026-05-13T09:00:00" },
        end: { dateTime: "2026-05-13T10:00:00" },
      });
    }
    if (callIndex === 2) return textResponse(400, "bad event");
    throw "calendar network down";
  }) as any;

  try {
    const created = await msCalendarCreate.execute(createMicrosoftToolCtx(), {
      summary: "Review",
      start_time: "2026-05-13T09:00:00",
      end_time: "2026-05-13T10:00:00",
      description: "Discuss",
      location: "Room 1",
      attendees: [],
      timezone: "W. Europe Standard Time",
    });
    const failed = await msCalendarCreate.execute(createMicrosoftToolCtx(), {
      summary: "Bad",
      start_time: "2026-05-13T09:00:00",
      end_time: "2026-05-13T10:00:00",
    });
    const thrown = await msCalendarCreate.execute(createMicrosoftToolCtx(), {
      summary: "Network",
      start_time: "2026-05-13T09:00:00",
      end_time: "2026-05-13T10:00:00",
    });

    assert.equal(created.success, true);
    assert.equal((created.data as any).calendarLink, undefined);
    assert.equal((bodies[0]?.start as any).timeZone, "W. Europe Standard Time");
    assert.deepEqual(bodies[0]?.attendees, undefined);
    assert.equal(failed.success, false);
    assert.match(String(failed.error), /400/);
    assert.equal(thrown.success, false);
    assert.equal(thrown.error, "calendar network down");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Microsoft calendar delete handles success, missing IDs, provider errors, and thrown failures", async () => {
  const missing = await msCalendarDelete.execute(createMicrosoftToolCtx(), {});
  assert.equal(missing.success, false);

  const originalFetch = globalThis.fetch;
  let callIndex = 0;
  globalThis.fetch = (async () => {
    callIndex += 1;
    if (callIndex === 1) return textResponse(204, "");
    if (callIndex === 2) return textResponse(409, "conflict");
    throw new Error("delete network down");
  }) as any;

  try {
    const deleted = await msCalendarDelete.execute(createMicrosoftToolCtx(), {
      event_id: "event_ok",
    });
    const failed = await msCalendarDelete.execute(createMicrosoftToolCtx(), {
      event_id: "event_conflict",
    });
    const thrown = await msCalendarDelete.execute(createMicrosoftToolCtx(), {
      event_id: "event_throw",
    });

    assert.equal(deleted.success, true);
    assert.equal((deleted.data as any).eventId, "event_ok");
    assert.equal(failed.success, false);
    assert.match(String(failed.error), /409/);
    assert.equal(thrown.success, false);
    assert.equal(thrown.error, "delete network down");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
