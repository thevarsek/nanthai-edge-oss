import assert from "node:assert/strict";
import test from "node:test";

import {
  notionCreatePage,
  notionDeletePage,
  notionReadPage,
  notionSearch,
  notionUpdatePage,
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

function createToolCtx(options: { tokenThrows?: boolean } = {}) {
  const leases: Array<Record<string, unknown>> = [];
  return {
    leases,
    toolCtx: {
      userId: "user_1",
      ctx: {
        runQuery: async () => {
          if (options.tokenThrows) throw new Error("Notion connection missing");
          return {
            _id: "notion_1",
            userId: "user_1",
            provider: "notion",
            accessToken: "notion_token",
            refreshToken: "",
            expiresAt: 0,
            scopes: [],
            status: "active",
            connectedAt: 1,
          };
        },
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          leases.push(args);
          return "leaseMs" in args ? { granted: true, waitMs: 0 } : undefined;
        },
      },
    } as any,
  };
}

function withImmediateTimers<T>(run: () => Promise<T>) {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    callback();
    return 0 as any;
  }) as any;
  return run().finally(() => {
    globalThis.setTimeout = originalSetTimeout;
  });
}

test("notion search extracts database and page titles and reports upstream failures", async () => {
  await withImmediateTimers(async () => {
    const originalFetch = globalThis.fetch;
    const { toolCtx } = createToolCtx();
    const bodies: Array<Record<string, unknown>> = [];
    let callIndex = 0;

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      callIndex += 1;
      bodies.push(JSON.parse(String(init?.body)));
      if (callIndex === 1) {
        return jsonResponse(200, {
          has_more: true,
          results: [
            {
              object: "database",
              id: "db_1",
              title: [{ plain_text: "Roadmap" }],
              url: "https://notion.so/db_1",
              archived: true,
              last_edited_time: "2026-05-01T10:00:00Z",
            },
            {
              object: "page",
              id: "page_1",
              properties: {
                Name: {
                  type: "title",
                  title: [{ plain_text: "Launch notes" }],
                },
              },
              url: "https://notion.so/page_1",
            },
          ],
        });
      }
      return textResponse(429, "rate limited");
    }) as any;

    try {
      const found = await notionSearch.execute(toolCtx, {
        query: "launch",
        filter_type: "page",
        max_results: 99,
      });
      assert.equal(found.success, true);
      assert.equal(bodies[0]?.page_size, 25);
      assert.deepEqual(bodies[0]?.filter, { value: "page", property: "object" });
      assert.deepEqual((found.data as any).results.map((item: any) => item.title), [
        "Roadmap",
        "Launch notes",
      ]);
      assert.equal((found.data as any).results[0].archived, true);
      assert.equal((found.data as any).hasMore, true);

      const failed = await notionSearch.execute(toolCtx, {
        query: "launch",
        filter_type: "workspace",
      });
      assert.equal(failed.success, false);
      assert.match(String(failed.error), /HTTP 429/);
      assert.equal(bodies[1]?.filter, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("notion read page covers truncation, missing title text, and token failures", async () => {
  await withImmediateTimers(async () => {
    const originalFetch = globalThis.fetch;
    const { toolCtx } = createToolCtx();
    let callIndex = 0;
    const longMarkdown = "x".repeat(100_050);

    globalThis.fetch = (async () => {
      callIndex += 1;
      if (callIndex === 1) {
        return jsonResponse(200, {
          id: "page_long",
          url: "https://notion.so/page_long",
          last_edited_time: "2026-05-02T10:00:00Z",
          archived: true,
          properties: {
            Title: { type: "title", title: [] },
          },
        });
      }
      return jsonResponse(200, { markdown: longMarkdown });
    }) as any;

    try {
      const read = await notionReadPage.execute(toolCtx, { page_id: "page_long" });
      assert.equal(read.success, true);
      assert.equal((read.data as any).title, "Untitled");
      assert.equal((read.data as any).archived, true);
      assert.equal((read.data as any).truncated, true);
      assert.equal((read.data as any).characterCount, 100_000);
      assert.match(String((read.data as any).message), /truncated/);

      const missingConnection = await notionReadPage.execute(
        createToolCtx({ tokenThrows: true }).toolCtx,
        { page_id: "page_1" },
      );
      assert.equal(missingConnection.success, false);
      assert.match(String(missingConnection.error), /Notion connection missing/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("notion page create update and delete cover URL/no-URL confirmations and metadata fallbacks", async () => {
  await withImmediateTimers(async () => {
    const originalFetch = globalThis.fetch;
    const { toolCtx } = createToolCtx();
    let callIndex = 0;

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      callIndex += 1;
      if (callIndex === 1) {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.parent.page_id, "parent_1");
        assert.equal(body.markdown, "# Draft");
        return jsonResponse(200, {
          id: "page_created",
          url: "https://notion.so/page_created",
        });
      }
      if (callIndex === 2) {
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(body, { markdown: "Replacement", type: "replace" });
        return jsonResponse(200, {});
      }
      if (callIndex === 3) return textResponse(400, "metadata unavailable");
      if (callIndex === 4) {
        return jsonResponse(200, {
          properties: {
            Name: { type: "title", title: [{ plain_text: "Archived page" }] },
          },
        });
      }
      if (callIndex === 5) {
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(body, { archived: true });
        return jsonResponse(200, {});
      }
      throw new Error(`Unexpected fetch call ${callIndex}`);
    }) as any;

    try {
      const created = await notionCreatePage.execute(toolCtx, {
        parent_page_id: "parent_1",
        title: "Quarterly Plan",
        markdown: "# Draft",
      });
      assert.equal(created.success, true);
      assert.match(String((created.data as any).message), /Open in Notion/);

      const updated = await notionUpdatePage.execute(toolCtx, {
        page_id: "page_1",
        markdown: "Replacement",
        mode: "replace",
      });
      assert.equal(updated.success, true);
      assert.equal((updated.data as any).title, "Unknown");
      assert.equal((updated.data as any).url, undefined);
      assert.match(String((updated.data as any).message), /ID: page_1/);

      const archived = await notionDeletePage.execute(toolCtx, { page_id: "page_1" });
      assert.equal(archived.success, true);
      assert.equal((archived.data as any).title, "Archived page");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
