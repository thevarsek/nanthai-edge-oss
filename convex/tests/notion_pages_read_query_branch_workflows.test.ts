import assert from "node:assert/strict";
import test from "node:test";

import {
  notionQueryDatabase,
  notionReadPage,
  notionSearch,
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
          if ("leaseMs" in args) return { granted: true, waitMs: 0 };
          releases.push(args);
          return undefined;
        },
      },
    } as any,
  };
}

test("notion read/query branches cover empty search, fallback errors, and property variants", async () => {
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
      const body = JSON.parse(String(init?.body));
      assert.equal(body.query, undefined);
      assert.equal(body.filter, undefined);
      return jsonResponse(200, { results: [], has_more: false });
    }
    if (callIndex === 2) {
      return jsonResponse(200, {
        id: "page_fallback",
        url: "https://notion.so/page_fallback",
        properties: {},
      });
    }
    if (callIndex === 3) return textResponse(404, "markdown unavailable");
    if (callIndex === 4) return textResponse(403, "metadata denied");
    if (callIndex === 5) {
      return jsonResponse(200, {
        results: [{
          id: "entry_variants",
          url: "https://notion.so/entry_variants",
          last_edited_time: "2026-05-02T10:00:00Z",
          properties: {
            Rich: { type: "rich_text", rich_text: [{ plain_text: "Notes" }] },
            Url: { type: "url", url: "https://example.com" },
            Email: { type: "email", email: "owner@example.com" },
            Phone: { type: "phone_number", phone_number: "+15551234567" },
            DateRange: { type: "date", date: { start: "2026-05-01", end: "2026-05-02" } },
            People: { type: "people", people: [{ name: "Ada" }, {}] },
            Formula: { type: "formula", formula: { type: "string", string: "computed" } },
            FormulaMissing: { type: "formula", formula: {} },
            Relation: { type: "relation", relation: [{ id: "page_a" }, { id: "page_b" }] },
            Rollup: { type: "rollup", rollup: { type: "number", number: 7 } },
            RollupMissing: { type: "rollup", rollup: {} },
            Created: { type: "created_time", created_time: "2026-05-01T09:00:00Z" },
            Edited: { type: "last_edited_time", last_edited_time: "2026-05-02T10:00:00Z" },
            Unknown: { type: "files" },
            MissingType: {},
          },
        }],
        has_more: true,
      });
    }
    throw new Error(`Unexpected fetch call ${callIndex}`);
  }) as any;

  try {
    const emptySearch = await notionSearch.execute(toolCtx, {});
    assert.equal(emptySearch.success, true);
    assert.equal((emptySearch.data as any).resultCount, 0);
    assert.match(String((emptySearch.data as any).message), /No results found/);

    const missingPage = await notionReadPage.execute(toolCtx, {});
    assert.equal(missingPage.success, false);
    assert.match(String(missingPage.error), /page_id/);

    const readFallback = await notionReadPage.execute(toolCtx, { page_id: "page_fallback" });
    assert.equal(readFallback.success, true);
    assert.equal((readFallback.data as any).title, "Untitled");
    assert.match(String((readFallback.data as any).content), /Could not retrieve markdown/);

    const deniedRead = await notionReadPage.execute(toolCtx, { page_id: "page_denied" });
    assert.equal(deniedRead.success, false);
    assert.match(String(deniedRead.error), /metadata/);

    const queried = await notionQueryDatabase.execute(toolCtx, {
      database_id: "db_variants",
      max_results: 1,
    });
    assert.equal(queried.success, true);
    assert.equal((queried.data as any).hasMore, true);
    assert.deepEqual((queried.data as any).entries[0].properties, {
      Rich: "Notes",
      Url: "https://example.com",
      Email: "owner@example.com",
      Phone: "+15551234567",
      DateRange: "2026-05-01 → 2026-05-02",
      People: "Ada, Unknown",
      Formula: "computed",
      FormulaMissing: null,
      Relation: ["page_a", "page_b"],
      Rollup: 7,
      RollupMissing: null,
      Created: "2026-05-01T09:00:00Z",
      Edited: "2026-05-02T10:00:00Z",
      Unknown: "[files]",
      MissingType: "[unknown]",
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("notion database queries preserve nullable property values and non-error failures", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const { toolCtx } = createNotionToolCtx();
  let callIndex = 0;

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    callback();
    return 0 as any;
  }) as any;
  globalThis.fetch = (async () => {
    callIndex += 1;
    if (callIndex === 1) {
      return jsonResponse(200, {
        results: [{
          id: "entry_nulls",
          properties: {
            Title: { type: "title" },
            Notes: { type: "rich_text" },
            Status: { type: "status", status: null },
            Tags: { type: "multi_select" },
            Date: { type: "date", date: null },
            People: { type: "people" },
            Relation: { type: "relation" },
          },
        }],
        has_more: false,
      });
    }
    throw "notion transport unavailable";
  }) as any;

  try {
    const queried = await notionQueryDatabase.execute(toolCtx, {
      database_id: "db_nullable_shapes",
    });
    assert.equal(queried.success, true);
    assert.deepEqual((queried.data as any).entries[0].properties, {
      Title: "",
      Notes: "",
      Status: null,
      Tags: [],
      Date: null,
      People: "",
      Relation: [],
    });
    assert.equal((queried.data as any).entries[0].title, "Untitled");

    const failed = await notionQueryDatabase.execute(toolCtx, {
      database_id: "db_failure",
    });
    assert.equal(failed.success, false);
    assert.equal(failed.error, "notion transport unavailable");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});
