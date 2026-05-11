import assert from "node:assert/strict";
import test from "node:test";

import {
  clozePersonAdd,
  clozePersonChange,
  clozePersonCount,
  clozePersonFind,
} from "../tools/cloze/people";
import {
  clozeProjectChange,
  clozeProjectFind,
} from "../tools/cloze/projects";

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    headers: { get: () => null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as any;
}

function createClozeToolCtx(connection: Record<string, unknown> | null = {
  _id: "cloze_1",
  userId: "user_1",
  provider: "cloze",
  accessToken: "cloze_token",
  refreshToken: "",
  expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
  scopes: ["api_key"],
  status: "active",
  connectedAt: 1,
}) {
  const gateCalls: Array<Record<string, unknown>> = [];
  return {
    gateCalls,
    toolCtx: {
      userId: "user_1",
      ctx: {
        runQuery: async () => connection,
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          gateCalls.push(args);
          if ("leaseMs" in args) return { granted: true, waitMs: 0 };
          return undefined;
        },
      },
    } as any,
  };
}

test("Cloze people tools build filters, bodies, success payloads, and API error branches", async () => {
  const { toolCtx, gateCalls } = createClozeToolCtx();
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.includes("/people/find?")) {
      if (url.includes("freeformquery=error")) {
        return jsonResponse(200, { errorcode: 42, message: "bad people query" });
      }
      if (url.includes("freeformquery=http")) {
        return jsonResponse(400, { error: "people down" });
      }
      if (url.includes("countonly=true")) {
        return jsonResponse(200, { errorcode: 0 });
      }
      assert.match(url, /stage=lead/);
      assert.match(url, /pagesize=100/);
      assert.match(url, /pagenumber=2/);
      return jsonResponse(200, {
        errorcode: 0,
        availablecount: 3,
        pagenumber: 2,
        pagesize: 100,
        people: [{ name: "Ada" }],
      });
    }
    if (url.endsWith("/people/create") || url.endsWith("/people/update")) {
      requestBodies.push(JSON.parse(String(init?.body)));
      if (requestBodies.at(-1)?.name === "Api Error") {
        return jsonResponse(200, { errorcode: 7 });
      }
      if (requestBodies.at(-1)?.name === "Http Error") {
        return jsonResponse(400, { error: "write failed" });
      }
      return jsonResponse(200, { errorcode: 0 });
    }
    throw new Error(`Unexpected Cloze request: ${url}`);
  }) as any;

  try {
    const found = await clozePersonFind.execute(toolCtx, {
      query: "Ada",
      stage: "lead",
      segment: "customer",
      step: "intro",
      assignee: "owner@example.com",
      sort: "name",
      scope: "team",
      page_size: 500,
      page_number: 2,
    });
    const findApiError = await clozePersonFind.execute(toolCtx, { query: "error" });
    const findHttpError = await clozePersonFind.execute(toolCtx, { query: "http" });
    const counted = await clozePersonCount.execute(toolCtx, {
      query: "Ada",
      stage: "lead",
      segment: "customer",
      step: "intro",
      assignee: "owner@example.com",
      scope: "team",
    });
    const added = await clozePersonAdd.execute(toolCtx, {
      name: "Ada",
      first: "Ada",
      last: "Lovelace",
      emails: [{ value: "ada@example.com", work: true }],
      phones: [{ value: "+15551234567", mobile: true }],
      stage: "lead",
      segment: "customer",
      step: "intro",
      headline: "Engineer",
      keywords: ["math"],
      notes: "Important",
      assign_to: "owner@example.com",
      share_to: "team",
      custom_fields: [{ id: "field", value: "value" }],
    });
    const addApiError = await clozePersonAdd.execute(toolCtx, { name: "Api Error" });
    const addHttpError = await clozePersonAdd.execute(toolCtx, { name: "Http Error" });
    const changed = await clozePersonChange.execute(toolCtx, {
      name: "Ada",
      emails: [{ value: "ada@example.com" }],
      phones: [{ value: "+15551234567" }],
      stage: "current",
      segment: "customer",
      step: "followup",
      headline: "Principal",
      keywords: ["vip"],
      notes: "Updated",
      assign_to: "owner@example.com",
      custom_fields: [{ id: "field", value: "new" }],
      app_links: [{ source: "crm", uniqueid: "123" }],
    });

    assert.equal(found.success, true);
    assert.equal((found.data as any).total, 3);
    assert.equal(findApiError.success, false);
    assert.match(String(findApiError.error), /Cloze error 42/);
    assert.equal(findHttpError.success, false);
    assert.match(String(findHttpError.error), /HTTP 400/);
    assert.equal(counted.success, true);
    assert.equal((counted.data as any).count, 0);
    assert.equal(added.success, true);
    assert.equal(addApiError.success, false);
    assert.match(String(addApiError.error), /Unknown error/);
    assert.equal(addHttpError.success, false);
    assert.match(String(addHttpError.error), /HTTP 400/);
    assert.equal(changed.success, true);
    assert.ok(requestBodies.some((body) => body.assignTo === "owner@example.com"));
    assert.ok(requestBodies.some((body) => Array.isArray(body.appLinks)));
    assert.ok(gateCalls.some((call) => call.provider === "cloze"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloze project tools build filters, bodies, and failure responses", async () => {
  const { toolCtx } = createClozeToolCtx();
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.includes("/projects/find?")) {
      if (url.includes("freeformquery=error")) {
        return jsonResponse(200, { errorcode: 9 });
      }
      if (url.includes("freeformquery=http")) {
        return jsonResponse(400, { error: "projects down" });
      }
      assert.match(url, /hidelostdone=true/);
      assert.match(url, /collaborator=ally%40example.com/);
      return jsonResponse(200, {
        errorcode: 0,
        availablecount: 2,
        pagenumber: 3,
        pagesize: 100,
        projects: [{ name: "Deal" }],
      });
    }
    if (url.endsWith("/projects/update")) {
      requestBodies.push(JSON.parse(String(init?.body)));
      if (requestBodies.at(-1)?.name === "Api Error") {
        return jsonResponse(200, { errorcode: 8, message: "bad project" });
      }
      if (requestBodies.at(-1)?.name === "Http Error") {
        return jsonResponse(400, { error: "write failed" });
      }
      return jsonResponse(200, { errorcode: 0 });
    }
    throw new Error(`Unexpected Cloze request: ${url}`);
  }) as any;

  try {
    const found = await clozeProjectFind.execute(toolCtx, {
      query: "Deal",
      stage: "current",
      segment: "enterprise",
      step: "proposal",
      assignee: "owner@example.com",
      collaborator: "ally@example.com",
      scope: "team",
      sort: "value",
      hide_lost_done: true,
      page_size: 250,
      page_number: 3,
    });
    const apiError = await clozeProjectFind.execute(toolCtx, { query: "error" });
    const httpError = await clozeProjectFind.execute(toolCtx, { query: "http" });
    const changed = await clozeProjectChange.execute(toolCtx, {
      name: "Deal",
      summary: "Summary",
      stage: "won",
      segment: "enterprise",
      step: "done",
      keywords: ["strategic"],
      notes: "Notes",
      at_a_glance_notes: "At a glance",
      start_date: "2026-05-01",
      end_date: "2026-05-31",
      project_team: ["ally@example.com"],
      custom_fields: [{ id: "field", value: "value" }],
      app_links: [{ source: "crm", uniqueid: "deal_1" }],
    });
    const changeApiError = await clozeProjectChange.execute(toolCtx, { name: "Api Error" });
    const changeHttpError = await clozeProjectChange.execute(toolCtx, { name: "Http Error" });

    assert.equal(found.success, true);
    assert.equal((found.data as any).total, 2);
    assert.equal(apiError.success, false);
    assert.match(String(apiError.error), /Unknown error/);
    assert.equal(httpError.success, false);
    assert.match(String(httpError.error), /HTTP 400/);
    assert.equal(changed.success, true);
    assert.equal(changeApiError.success, false);
    assert.match(String(changeApiError.error), /bad project/);
    assert.equal(changeHttpError.success, false);
    assert.match(String(changeHttpError.error), /HTTP 400/);
    assert.ok(requestBodies.some((body) => body.atAGlanceNotes === "At a glance"));
    assert.ok(requestBodies.some((body) => Array.isArray(body.projectTeam)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloze tools surface inactive, missing, and unsupported OAuth-style connections", async () => {
  const missing = await clozePersonFind.execute(createClozeToolCtx(null).toolCtx, {});
  const inactive = await clozePersonCount.execute(
    createClozeToolCtx({
      _id: "cloze_1",
      userId: "user_1",
      provider: "cloze",
      accessToken: "token",
      refreshToken: "",
      expiresAt: 0,
      scopes: ["api_key"],
      status: "expired",
      connectedAt: 1,
    }).toolCtx,
    {},
  );
  const oauthStyle = await clozeProjectFind.execute(
    createClozeToolCtx({
      _id: "cloze_1",
      userId: "user_1",
      provider: "cloze",
      accessToken: "token",
      refreshToken: "refresh",
      expiresAt: Date.now() + 60_000,
      scopes: ["contacts"],
      status: "active",
      connectedAt: 1,
    }).toolCtx,
    {},
  );

  assert.equal(missing.success, false);
  assert.match(String(missing.error), /No Cloze account connected/);
  assert.equal(inactive.success, false);
  assert.match(String(inactive.error), /connection is expired/);
  assert.equal(oauthStyle.success, false);
  assert.match(String(oauthStyle.error), /OAuth2 connections are not yet supported/);
});
