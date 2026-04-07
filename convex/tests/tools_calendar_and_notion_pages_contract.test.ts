import assert from "node:assert/strict";
import test from "node:test";

import {
  calendarCreate,
  calendarDelete,
  calendarList,
} from "../tools/google/calendar";
import {
  msCalendarCreate,
  msCalendarDelete,
  msCalendarList,
} from "../tools/microsoft/calendar";
import {
  notionQueryDatabase,
  notionReadPage,
  notionSearch,
  notionUpdateDatabaseEntry,
} from "../tools/notion/pages";

function jsonResponse(status: number, payload: unknown, headers?: Record<string, string>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers?.[name.toLowerCase()] ?? headers?.[name] ?? null,
    },
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

function createGoogleToolCtx() {
  return {
    userId: "user_1",
    ctx: {
      runQuery: async () => ({
        _id: "google_1",
        userId: "user_1",
        provider: "google",
        accessToken: "google_token",
        refreshToken: "refresh_1",
        expiresAt: Date.now() + 60 * 60 * 1000,
        scopes: ["https://www.googleapis.com/auth/calendar"],
        status: "active",
        connectedAt: 1,
      }),
      runMutation: async () => undefined,
    },
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

function createNotionToolCtx() {
  const releases: Array<Record<string, unknown>> = [];
  return {
    releases,
    toolCtx: {
      userId: "user_1",
      ctx: {
        runQuery: async () => ({
          _id: "notion_1",
          userId: "user_1",
          provider: "notion",
          accessToken: "notion_token",
          refreshToken: "",
          expiresAt: 0,
          scopes: [],
          status: "active",
          connectedAt: 1,
        }),
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          if ("leaseMs" in args) {
            return { granted: true, waitMs: 0 };
          }
          releases.push(args);
          return undefined;
        },
      },
    } as any,
  };
}

test("google calendar tools list, create, and delete events with canonical payloads", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (url.includes("/events?")) {
      return jsonResponse(200, {
        items: [{
          id: "evt_1",
          summary: "Planning",
          description: "Quarterly planning sync",
          location: "Room 5",
          start: { dateTime: "2026-05-01T09:00:00Z" },
          end: { dateTime: "2026-05-01T10:00:00Z" },
          attendees: [{ email: "a@example.com", displayName: "Alice", responseStatus: "accepted" }],
          organizer: { email: "owner@example.com" },
          htmlLink: "https://calendar.google.com/event?eid=1",
          status: "confirmed",
        }],
      });
    }
    if (url.endsWith("/calendars/primary")) {
      return jsonResponse(200, { timeZone: "Europe/London" });
    }
    if (url.endsWith("/calendars/primary/events") && init?.method === "POST") {
      return jsonResponse(200, {
        id: "evt_2",
        summary: "Board review",
        htmlLink: "https://calendar.google.com/event?eid=2",
        start: { dateTime: "2026-05-02T13:00:00" },
        end: { dateTime: "2026-05-02T14:00:00" },
        status: "confirmed",
      });
    }
    if (url.endsWith("/events/evt_2") && init?.method === "DELETE") {
      return { ok: false, status: 410, text: async () => "gone" } as any;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const listed = await calendarList.execute(createGoogleToolCtx(), {
      max_results: 5,
      time_min: "2026-05-01T00:00:00Z",
      time_max: "2026-05-03T00:00:00Z",
      query: "planning",
    });

    assert.equal(listed.success, true);
    assert.equal((listed.data as any).events[0].summary, "Planning");
    assert.equal((listed.data as any).events[0].attendees[0].name, "Alice");
    assert.match(requests[0]!.url, /q=planning/);
    assert.match(requests[0]!.url, /maxResults=5/);

    const created = await calendarCreate.execute(createGoogleToolCtx(), {
      summary: "Board review",
      start_time: "2026-05-02T13:00:00",
      end_time: "2026-05-02T14:00:00",
      attendees: ["ceo@example.com"],
      description: "Discuss Q2",
      location: "HQ",
    });

    assert.equal(created.success, true);
    assert.equal((created.data as any).timezone, "Europe/London");
    const createBody = JSON.parse(String(requests[2]!.init?.body));
    assert.equal(createBody.start.timeZone, "Europe/London");
    assert.deepEqual(createBody.attendees, [{ email: "ceo@example.com" }]);

    const deleted = await calendarDelete.execute(createGoogleToolCtx(), {
      event_id: "evt_2",
    });

    assert.equal(deleted.success, true);
    assert.match(String((deleted.data as any).message), /already deleted/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("microsoft calendar tools build Graph requests and handle fallback timezone/delete cases", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (url.includes("/calendarView?")) {
      return jsonResponse(200, {
        value: [{
          id: "ms_evt_1",
          subject: "Team's plan",
          bodyPreview: "Plan details",
          start: { dateTime: "2026-05-01T09:00:00", timeZone: "UTC" },
          end: { dateTime: "2026-05-01T10:00:00", timeZone: "UTC" },
          location: { displayName: "Conf Room" },
          attendees: [{
            emailAddress: { address: "a@example.com", name: "Alice" },
            status: { response: "accepted" },
          }],
          organizer: { emailAddress: { address: "owner@example.com" } },
          webLink: "https://outlook.office.com/calendar/item/1",
        }],
      });
    }
    if (url.endsWith("/mailboxSettings/timeZone")) {
      return textResponse(500, "unavailable");
    }
    if (url.endsWith("/events") && init?.method === "POST") {
      return jsonResponse(200, {
        id: "ms_evt_2",
        subject: "All hands",
        webLink: "https://outlook.office.com/calendar/item/2",
        start: { dateTime: "2026-05-03T00:00:00", timeZone: "UTC" },
        end: { dateTime: "2026-05-04T00:00:00", timeZone: "UTC" },
      });
    }
    if (url.endsWith("/events/ms_evt_2") && init?.method === "DELETE") {
      return textResponse(404, "missing");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const listed = await msCalendarList.execute(createMicrosoftToolCtx(), {
      max_results: 3,
      time_min: "2026-05-01T00:00:00Z",
      time_max: "2026-05-03T00:00:00Z",
      query: "Team's plan",
    });

    assert.equal(listed.success, true);
    assert.equal((listed.data as any).events[0].summary, "Team's plan");
    const decodedListUrl = decodeURIComponent(requests[0]!.url).replace(/\+/g, " ");
    assert.match(decodedListUrl, /contains\(subject,'Team''s plan'\)/);

    const created = await msCalendarCreate.execute(createMicrosoftToolCtx(), {
      summary: "All hands",
      start_time: "2026-05-03",
      end_time: "2026-05-04",
      attendees: ["team@example.com"],
    });

    assert.equal(created.success, true);
    assert.equal((created.data as any).timezone, "UTC");
    const createBody = JSON.parse(String(requests[2]!.init?.body));
    assert.equal(createBody.isAllDay, true);
    assert.equal(createBody.start.timeZone, "UTC");
    assert.deepEqual(createBody.attendees, [{
      emailAddress: { address: "team@example.com" },
      type: "required",
    }]);

    const deleted = await msCalendarDelete.execute(createMicrosoftToolCtx(), {
      event_id: "ms_evt_2",
    });

    assert.equal(deleted.success, false);
    assert.match(String(deleted.error), /already been deleted/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notion search and read tools normalize titles, markdown fallback, and truncation", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const { toolCtx, releases } = createNotionToolCtx();
  const longMarkdown = "A".repeat(100_050);
  let callIndex = 0;

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    callback();
    return 0 as any;
  }) as any;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    callIndex += 1;
    if (callIndex === 1) {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.filter, { value: "database", property: "object" });
      return jsonResponse(200, {
        results: [
          {
            object: "database",
            id: "db_1",
            title: [{ plain_text: "Roadmap DB" }],
            url: "https://notion.so/db_1",
            last_edited_time: "2026-05-01T10:00:00Z",
          },
          {
            object: "page",
            id: "page_1",
            properties: {
              Name: {
                type: "title",
                title: [{ plain_text: "Launch Plan" }],
              },
            },
            url: "https://notion.so/page_1",
            archived: false,
          },
        ],
        has_more: false,
      });
    }
    if (callIndex === 2) {
      return jsonResponse(200, {
        id: "page_1",
        url: "https://notion.so/page_1",
        archived: false,
        last_edited_time: "2026-05-01T12:00:00Z",
        properties: {
          Title: {
            type: "title",
            title: [{ plain_text: "Launch Plan" }],
          },
        },
      });
    }
    if (callIndex === 3) {
      return jsonResponse(200, { markdown: longMarkdown });
    }
    throw new Error(`Unexpected fetch call ${callIndex}`);
  }) as any;

  try {
    const searched = await notionSearch.execute(toolCtx, {
      query: "roadmap",
      filter_type: "database",
      max_results: 25,
    });

    assert.equal(searched.success, true);
    assert.equal((searched.data as any).results[0].title, "Roadmap DB");
    assert.equal((searched.data as any).results[1].title, "Launch Plan");

    const read = await notionReadPage.execute(toolCtx, {
      page_id: "page_1",
    });

    assert.equal(read.success, true);
    assert.equal((read.data as any).title, "Launch Plan");
    assert.equal((read.data as any).truncated, true);
    assert.equal((read.data as any).characterCount, 100000);
    assert.equal(releases.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("notion database tools map property payloads and flatten query results", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const { toolCtx } = createNotionToolCtx();
  let callIndex = 0;

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    callback();
    return 0 as any;
  }) as any;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    callIndex += 1;
    if (callIndex === 1) {
      return jsonResponse(200, {
        id: "page_2",
        url: "https://notion.so/page_2",
        properties: {
          Title: { type: "title", title: [{ plain_text: "Task A" }] },
          Status: { type: "status" },
          Tags: { type: "multi_select" },
          Due: { type: "date" },
          Done: { type: "checkbox" },
          Score: { type: "number" },
        },
      });
    }
    if (callIndex === 2) {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.properties.Status, { status: { name: "Done" } });
      assert.deepEqual(body.properties.Tags, {
        multi_select: [{ name: "urgent" }, { name: "review" }],
      });
      assert.deepEqual(body.properties.Done, { checkbox: true });
      assert.deepEqual(body.properties.Score, { number: 42 });
      return jsonResponse(200, {
        id: "page_2",
        url: "https://notion.so/page_2",
        properties: {
          Title: { type: "title", title: [{ plain_text: "Task A" }] },
        },
      });
    }
    if (callIndex === 3) {
      return jsonResponse(200, {
        results: [{
          id: "entry_1",
          url: "https://notion.so/entry_1",
          last_edited_time: "2026-05-01T14:00:00Z",
          properties: {
            Title: { type: "title", title: [{ plain_text: "Task A" }] },
            Done: { type: "checkbox", checkbox: true },
            Score: { type: "number", number: 42 },
            Status: { type: "status", status: { name: "Done" } },
            Tags: { type: "multi_select", multi_select: [{ name: "urgent" }] },
          },
        }],
        has_more: false,
      });
    }
    throw new Error(`Unexpected fetch call ${callIndex}`);
  }) as any;

  try {
    const updated = await notionUpdateDatabaseEntry.execute(toolCtx, {
      page_id: "page_2",
      properties: {
        Status: "Done",
        Tags: ["urgent", "review"],
        Due: "2026-05-15",
        Done: true,
        Score: 42,
      },
    });

    assert.equal(updated.success, true);
    assert.deepEqual((updated.data as any).updatedFields, [
      "Status",
      "Tags",
      "Due",
      "Done",
      "Score",
    ]);

    const queried = await notionQueryDatabase.execute(toolCtx, {
      database_id: "db_1",
      filter: { property: "Status", status: { equals: "Done" } },
      max_results: 10,
    });

    assert.equal(queried.success, true);
    assert.deepEqual((queried.data as any).entries[0].properties, {
      Title: "Task A",
      Done: true,
      Score: 42,
      Status: "Done",
      Tags: ["urgent"],
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});
