import assert from "node:assert/strict";
import test from "node:test";

import {
  notionCreatePage,
  notionDeletePage,
  notionUpdateDatabaseEntry,
  notionUpdatePage,
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

test("notion page mutation tools cover validation, append mode, and archive failures", async () => {
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
      assert.equal(body.markdown, "");
      return jsonResponse(200, { id: "created_page" });
    }
    if (callIndex === 2) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.type, "insert");
      return jsonResponse(200, {});
    }
    if (callIndex === 3) {
      return jsonResponse(200, {
        url: "https://notion.so/updated",
        properties: { Title: { type: "title", title: [] } },
      });
    }
    if (callIndex === 4) return jsonResponse(200, {});
    if (callIndex === 5) return textResponse(500, "archive failed");
    throw new Error(`Unexpected fetch call ${callIndex}`);
  }) as any;

  try {
    const missingCreate = await notionCreatePage.execute(toolCtx, {
      parent_page_id: "",
      title: "",
      markdown: "body",
    });
    assert.equal(missingCreate.success, false);

    const created = await notionCreatePage.execute(toolCtx, {
      parent_page_id: "parent_1",
      title: "Untitled child",
    });
    assert.equal(created.success, true);
    assert.match(String((created.data as any).message), /ID: created_page/);

    const missingUpdate = await notionUpdatePage.execute(toolCtx, {
      page_id: "page_1",
      markdown: "",
    });
    assert.equal(missingUpdate.success, false);

    const appended = await notionUpdatePage.execute(toolCtx, {
      page_id: "page_1",
      markdown: "More notes",
      mode: "append",
    });
    assert.equal(appended.success, true);
    assert.equal((appended.data as any).title, "Untitled");
    assert.match(String((appended.data as any).message), /Appended content/);

    const missingDelete = await notionDeletePage.execute(toolCtx, {});
    assert.equal(missingDelete.success, false);

    const failedDelete = await notionDeletePage.execute(toolCtx, { page_id: "page_1" });
    assert.equal(failedDelete.success, false);
    assert.match(String(failedDelete.error), /Failed to archive Notion page \(HTTP 500\)\./);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("notion database updates build supported payload variants and skip unsupported values", async () => {
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
      return jsonResponse(200, {
        url: "https://notion.so/source",
        properties: {
          Title: { type: "title" },
          Notes: { type: "rich_text" },
          SelectEmpty: { type: "select" },
          Link: { type: "url" },
          Email: { type: "email" },
          Phone: { type: "phone_number" },
          DateObject: { type: "date" },
          Relation: { type: "relation" },
        },
      });
    }
    if (callIndex === 2) {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.properties.Title, { title: [{ text: { content: "Renamed" } }] });
      assert.deepEqual(body.properties.SelectEmpty, { select: null });
      assert.deepEqual(body.properties.Link, { url: null });
      assert.deepEqual(body.properties.Email, { email: null });
      assert.deepEqual(body.properties.Phone, { phone_number: null });
      assert.deepEqual(body.properties.Relation, { relation: [{ id: "page_a" }, { id: "page_b" }] });
      assert.deepEqual(body.properties.UnknownBool, { checkbox: true });
      assert.deepEqual(body.properties.UnknownNumber, { number: 9 });
      assert.equal("UnknownObject" in body.properties, false);
      return jsonResponse(200, {
        id: "page_payloads",
        properties: { Title: { type: "title", title: [{ plain_text: "Renamed" }] } },
      });
    }
    if (callIndex === 3) {
      return jsonResponse(200, { properties: { Formula: { type: "formula" } } });
    }
    throw new Error(`Unexpected fetch call ${callIndex}`);
  }) as any;

  try {
    const updated = await notionUpdateDatabaseEntry.execute(toolCtx, {
      page_id: "page_payloads",
      properties: {
        Title: "Renamed",
        Notes: "Details",
        SelectEmpty: "",
        Link: "",
        Email: null,
        Phone: undefined,
        DateObject: { start: "2026-05-01", end: "2026-05-02" },
        Relation: ["page_a", "page_b"],
        UnknownBool: true,
        UnknownNumber: 9,
        UnknownObject: { unsupported: true },
      },
    });
    assert.equal(updated.success, true);
    assert.equal((updated.data as any).url, "https://notion.so/source");

    const invalid = await notionUpdateDatabaseEntry.execute(toolCtx, {
      page_id: "page_invalid",
      properties: { Formula: { unsupported: true } },
    });
    assert.equal(invalid.success, false);
    assert.match(String(invalid.error), /Could not build valid property updates/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});
