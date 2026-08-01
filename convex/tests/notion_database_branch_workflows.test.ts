import assert from "node:assert/strict";
import test from "node:test";

import {
  notionQueryDatabase,
  notionUpdateDatabaseEntry,
} from "../tools/notion/pages";

function jsonResponse(status: number, payload: unknown): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function textResponse(status: number, body: string): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => {
      throw new Error("invalid json");
    },
    text: async () => body,
  };
}

function createToolCtx() {
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

async function withImmediateTimers<T>(run: () => Promise<T>) {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    callback();
    return 0 as any;
  }) as any;
  try {
    return await run();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
}

test("notion database workflows cover filters, empty results, update payload variants, and failures", async () => {
  await withImmediateTimers(async () => {
    const originalFetch = globalThis.fetch;
    const toolCtx = createToolCtx();
    const bodies: Array<Record<string, unknown>> = [];
    let callIndex = 0;

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      callIndex += 1;
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      if (callIndex === 1) return jsonResponse(200, { results: [], has_more: false });
      if (callIndex === 2) return textResponse(400, "bad filter");
      if (callIndex === 3) {
        return jsonResponse(200, {
          id: "entry_1",
          url: "https://notion.so/entry_1",
          properties: {
            Status: { type: "status" },
            Tags: { type: "multi_select" },
            Due: { type: "date" },
            Count: { type: "number" },
          },
        });
      }
      if (callIndex === 4) {
        const patchBody = JSON.parse(String(init?.body));
        assert.deepEqual(patchBody.properties.Status, { status: { name: "Done" } });
        assert.deepEqual(patchBody.properties.Tags, {
          multi_select: [{ name: "ops" }, { name: "review" }],
        });
        assert.deepEqual(patchBody.properties.Due, { date: { start: "2026-05-20" } });
        assert.deepEqual(patchBody.properties.Count, { number: 42 });
        return jsonResponse(200, {
          id: "entry_1",
          properties: {},
        });
      }
      if (callIndex === 5) return textResponse(500, "schema unavailable");
      throw new Error(`Unexpected fetch call ${callIndex}`);
    }) as any;

    try {
      const empty = await notionQueryDatabase.execute(toolCtx, {
        database_id: "db_1",
        filter: { property: "Status", status: { equals: "Done" } },
        max_results: 90,
      });
      assert.equal(empty.success, true);
      assert.equal((empty.data as any).resultCount, 0);
      assert.equal(bodies[0]?.page_size, 50);
      assert.deepEqual(bodies[0]?.filter, { property: "Status", status: { equals: "Done" } });
      assert.match(String((empty.data as any).message), /No entries/);

      const queryFailure = await notionQueryDatabase.execute(toolCtx, {
        database_id: "db_1",
      });
      assert.equal(queryFailure.success, false);
      assert.match(String(queryFailure.error), /Failed to query Notion database \(HTTP 400\)\./);

      const updated = await notionUpdateDatabaseEntry.execute(toolCtx, {
        page_id: "entry_1",
        properties: {
          Status: "Done",
          Tags: ["ops", "", null, "review"],
          Due: "2026-05-20",
          Count: "42",
        },
      });
      assert.equal(updated.success, true);
      assert.deepEqual((updated.data as any).updatedFields, ["Status", "Tags", "Due", "Count"]);
      assert.match(String((updated.data as any).message), /ID: entry_1/);

      const updateFailure = await notionUpdateDatabaseEntry.execute(toolCtx, {
        page_id: "entry_2",
        properties: { Status: "Done" },
      });
      assert.equal(updateFailure.success, false);
      assert.match(String(updateFailure.error), /metadata/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
