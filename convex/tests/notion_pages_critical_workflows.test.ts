import assert from "node:assert/strict";
import test from "node:test";

import {
  notionCreatePage,
  notionDeletePage,
  notionQueryDatabase,
  notionReadPage,
  notionSearch,
  notionUpdateDatabaseEntry,
  notionUpdatePage,
} from "../tools/notion/pages";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function titleProperty(title: string) {
  return { type: "title", title: [{ plain_text: title }] };
}

function buildToolCtx(fetches: Array<{ url: string; init?: RequestInit }>) {
  return {
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
      runMutation: async () => ({ granted: true, waitMs: 0 }),
    },
    recordFetch(url: string, init?: RequestInit) {
      fetches.push({ url, init });
    },
  };
}

test("notion page tools cover search, read, create, update, delete, and query success paths", async () => {
  const originalFetch = globalThis.fetch;
  const fetches: Array<{ url: string; init?: RequestInit }> = [];
  const ctx = buildToolCtx(fetches);

  const responses = [
    jsonResponse({
      has_more: false,
      results: [
        {
          object: "page",
          id: "page_1",
          url: "https://notion.so/page_1",
          last_edited_time: "2026-05-11T00:00:00Z",
          properties: { Name: titleProperty("Launch Notes") },
        },
        {
          object: "database",
          id: "db_1",
          title: [{ plain_text: "Pipeline" }],
          archived: true,
        },
      ],
    }),
    jsonResponse({
      id: "page_1",
      url: "https://notion.so/page_1",
      last_edited_time: "2026-05-11T00:00:00Z",
      properties: { Name: titleProperty("Launch Notes") },
    }),
    jsonResponse({ markdown: "## Launch\nReady." }),
    jsonResponse({ id: "page_new", url: "https://notion.so/page_new", created_time: "now" }),
    jsonResponse({ id: "page_1" }),
    jsonResponse({ url: "https://notion.so/page_1", properties: { Name: titleProperty("Launch Notes") } }),
    jsonResponse({ properties: { Name: titleProperty("Launch Notes") } }),
    jsonResponse({ id: "page_1" }),
    jsonResponse({
      id: "page_1",
      url: "https://notion.so/page_1",
      properties: {
        Name: titleProperty("Launch Notes"),
        Status: { type: "status" },
        Score: { type: "number" },
        Tags: { type: "multi_select" },
        Due: { type: "date" },
        Done: { type: "checkbox" },
      },
    }),
    jsonResponse({
      id: "page_1",
      url: "https://notion.so/page_1",
      properties: { Name: titleProperty("Launch Notes") },
    }),
    jsonResponse({
      has_more: false,
      results: [{
        id: "row_1",
        url: "https://notion.so/row_1",
        last_edited_time: "2026-05-11T00:00:00Z",
        properties: {
          Name: titleProperty("Row One"),
          Notes: { type: "rich_text", rich_text: [{ plain_text: "memo" }] },
          Count: { type: "number", number: 7 },
          Status: { type: "status", status: { name: "Done" } },
          Tags: { type: "multi_select", multi_select: [{ name: "urgent" }] },
          When: { type: "date", date: { start: "2026-05-11", end: "2026-05-12" } },
          Done: { type: "checkbox", checkbox: true },
          Owner: { type: "people", people: [{ name: "Ada" }] },
          Formula: { type: "formula", formula: { type: "number", number: 42 } },
          Relation: { type: "relation", relation: [{ id: "rel_1" }] },
          Unknown: { type: "unsupported" },
        },
      }],
    }),
  ];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    ctx.recordFetch(url, init);
    const response = responses.shift();
    assert.ok(response, `unexpected fetch ${url}`);
    return response;
  }) as any;

  try {
    const search = await notionSearch.execute(ctx as any, {
      query: "launch",
      filter_type: "page",
      max_results: 99,
    });
    assert.equal(search.success, true);
    assert.equal((search.data as any).resultCount, 2);

    const read = await notionReadPage.execute(ctx as any, { page_id: "page_1" });
    assert.equal(read.success, true);
    assert.equal((read.data as any).title, "Launch Notes");

    const created = await notionCreatePage.execute(ctx as any, {
      parent_page_id: "parent_1",
      title: "New Note",
      markdown: "# New",
    });
    assert.equal(created.success, true);

    const updated = await notionUpdatePage.execute(ctx as any, {
      page_id: "page_1",
      markdown: "Appendix",
      mode: "append",
    });
    assert.equal(updated.success, true);
    assert.equal((updated.data as any).mode, "append");

    const deleted = await notionDeletePage.execute(ctx as any, { page_id: "page_1" });
    assert.equal(deleted.success, true);
    assert.equal((deleted.data as any).archived, true);

    const dbUpdate = await notionUpdateDatabaseEntry.execute(ctx as any, {
      page_id: "page_1",
      properties: {
        Name: "Renamed",
        Status: "Done",
        Score: "42",
        Tags: ["urgent", "review"],
        Due: { start: "2026-05-11" },
        Done: true,
        Link: "https://example.com",
      },
    });
    assert.equal(dbUpdate.success, true);
    assert.deepEqual((dbUpdate.data as any).updatedFields, ["Name", "Status", "Score", "Tags", "Due", "Done", "Link"]);

    const queried = await notionQueryDatabase.execute(ctx as any, {
      database_id: "db_1",
      filter: { property: "Status", status: { equals: "Done" } },
      max_results: 100,
    });
    assert.equal(queried.success, true);
    assert.equal((queried.data as any).entries[0].properties.Formula, 42);

    assert.equal(responses.length, 0);
    assert.ok(fetches.some((entry) => entry.url.endsWith("/search")));
    assert.ok(fetches.some((entry) => String(entry.init?.body).includes('"page_size":25')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notion page tools return user-facing validation and HTTP errors", async () => {
  assert.equal((await notionReadPage.execute({} as any, {})).error, "Missing 'page_id' parameter.");
  assert.equal((await notionCreatePage.execute({} as any, { title: "No parent" })).error, "Missing 'parent_page_id' or 'title'.");
  assert.equal((await notionUpdatePage.execute({} as any, { page_id: "page_1" })).error, "Missing 'page_id' or 'markdown'.");
  assert.equal((await notionDeletePage.execute({} as any, {})).error, "Missing 'page_id' parameter.");
  assert.equal((await notionQueryDatabase.execute({} as any, {})).error, "Missing 'database_id' parameter.");

  const originalFetch = globalThis.fetch;
  const fetches: Array<{ url: string; init?: RequestInit }> = [];
  const ctx = buildToolCtx(fetches);
  globalThis.fetch = (async () => new Response("bad request", { status: 400 })) as any;

  try {
    const result = await notionSearch.execute(ctx as any, { query: "x" });
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /Notion search failed|bad request/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
