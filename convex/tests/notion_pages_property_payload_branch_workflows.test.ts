import assert from "node:assert/strict";
import test from "node:test";

import {
  notionSearch,
  notionUpdateDatabaseEntry,
} from "../tools/notion/pages";

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as any;
}

function createNotionToolCtx() {
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
      runMutation: async (_ref: unknown, args: Record<string, unknown>) =>
        "leaseMs" in args ? { granted: true, waitMs: 0 } : undefined,
    },
  } as any;
}

test("notion search preserves empty titles and update builds scalar property payloads", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const toolCtx = createNotionToolCtx();
  let callIndex = 0;

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    callback();
    return 0 as any;
  }) as any;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    callIndex += 1;
    if (callIndex === 1) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.query, "roadmap");
      assert.deepEqual(body.filter, { value: "database", property: "object" });
      return jsonResponse(200, {
        results: [{
          object: "database",
          id: "db_empty_title",
          title: [],
          last_edited_time: "2026-05-01T10:00:00Z",
        }, {
          object: "page",
          id: "page_empty_title",
          properties: { Name: { type: "title", title: [] } },
        }],
        has_more: false,
      });
    }
    if (callIndex >= 2 && callIndex <= 6) throw "notion search offline";
    if (callIndex === 7) {
      return jsonResponse(200, {
        id: "page_payloads",
        url: "https://notion.so/source",
        properties: {
          Name: { type: "title" },
          Summary: { type: "rich_text" },
          Select: { type: "select" },
          Status: { type: "status" },
          Tags: { type: "multi_select" },
          Due: { type: "date" },
          Link: { type: "url" },
          Email: { type: "email" },
          Phone: { type: "phone_number" },
          Related: { type: "relation" },
        },
      });
    }
    if (callIndex === 8) {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.properties.Name, { title: [{ text: { content: "Renamed" } }] });
      assert.deepEqual(body.properties.Summary, { rich_text: [{ text: { content: "Details" } }] });
      assert.deepEqual(body.properties.Select, { select: { name: "Roadmap" } });
      assert.deepEqual(body.properties.Status, { status: null });
      assert.deepEqual(body.properties.Tags, { multi_select: [{ name: "solo" }] });
      assert.deepEqual(body.properties.Due, { date: { start: "99" } });
      assert.deepEqual(body.properties.Link, { url: "https://example.com" });
      assert.deepEqual(body.properties.Email, { email: "owner@example.com" });
      assert.deepEqual(body.properties.Phone, { phone_number: "+15551234567" });
      assert.deepEqual(body.properties.Related, { relation: [{ id: "page_single" }] });
      return jsonResponse(200, {
        id: "page_payloads",
        properties: { Name: { type: "title", title: [] } },
      });
    }
    throw new Error(`Unexpected fetch call ${callIndex}`);
  }) as any;

  try {
    const search = await notionSearch.execute(toolCtx, {
      query: "roadmap",
      filter_type: "database",
    });
    assert.equal(search.success, true);
    assert.deepEqual(
      (search.data as any).results.map((item: { title: string }) => item.title),
      ["Untitled", "Untitled"],
    );

    const failedSearch = await notionSearch.execute(toolCtx, { query: "offline" });
    assert.equal(failedSearch.success, false);
    assert.equal(failedSearch.error, "notion search offline");

    const updated = await notionUpdateDatabaseEntry.execute(toolCtx, {
      page_id: "page_payloads",
      properties: {
        Name: "Renamed",
        Summary: "Details",
        Select: "Roadmap",
        Status: "",
        Tags: "solo",
        Due: 99,
        Link: "https://example.com",
        Email: "owner@example.com",
        Phone: "+15551234567",
        Related: "page_single",
      },
    });
    assert.equal(updated.success, true);
    assert.equal((updated.data as any).title, "Untitled");
    assert.equal((updated.data as any).url, "https://notion.so/source");
    assert.deepEqual((updated.data as any).updatedFields, [
      "Name",
      "Summary",
      "Select",
      "Status",
      "Tags",
      "Due",
      "Link",
      "Email",
      "Phone",
      "Related",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});
