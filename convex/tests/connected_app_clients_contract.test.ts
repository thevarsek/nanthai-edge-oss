import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  clozeFetch,
  clozeHeaders,
  validateClozeApiKey,
} from "../tools/cloze/client";
import { getGmailManualCredentials } from "../tools/google/gmail_manual_client";
import { callSlackMcpTool } from "../tools/slack/client";

function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? headers[name] ?? null,
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as any;
}

function buildGatedToolCtx() {
  const gateCalls: Array<Record<string, unknown>> = [];
  return {
    toolCtx: {
      userId: "user_1",
      ctx: {
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          gateCalls.push(args);
          if ("leaseMs" in args) return { granted: true, waitMs: 0 };
          return undefined;
        },
      },
    } as any,
    gateCalls,
  };
}

test("getGmailManualCredentials rejects inactive or incomplete connections", async () => {
  await assert.rejects(
    getGmailManualCredentials({ runQuery: async () => null } as any, "user_1"),
    (error) => {
      assert.ok(error instanceof ConvexError);
      assert.equal((error as ConvexError<any>).data.code, "INTEGRATION_NOT_CONNECTED");
      return true;
    },
  );

  await assert.rejects(
    getGmailManualCredentials(
      { runQuery: async () => ({ status: "active", email: "me@example.com" }) } as any,
      "user_1",
    ),
    (error) => {
      assert.ok(error instanceof ConvexError);
      assert.equal((error as ConvexError<any>).data.code, "INTEGRATION_NOT_CONNECTED");
      return true;
    },
  );
});

test("clozeHeaders and validateClozeApiKey normalize successful profile responses", async () => {
  assert.deepEqual(clozeHeaders("token_1"), {
    Authorization: "Bearer token_1",
    "Content-Type": "application/json",
    Accept: "application/json",
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    assert.match(url, /\/user\/profile$/);
    return jsonResponse(200, {
      errorcode: 0,
      profile: { email: "owner@example.com", first: "Ada", last: "Lovelace" },
    });
  }) as any;

  try {
    const profile = await validateClozeApiKey("token_1");
    assert.deepEqual(profile, {
      email: "owner@example.com",
      displayName: "Ada Lovelace",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("clozeFetch gates requests and returns final non-retryable responses", async () => {
  const { toolCtx, gateCalls } = buildGatedToolCtx();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; auth: string | null }> = [];

  globalThis.fetch = (async (url: string, init: RequestInit) => {
    fetchCalls.push({
      url,
      auth: (init.headers as Record<string, string>).Authorization ?? null,
    });
    return jsonResponse(404, { error: "not found" });
  }) as any;

  try {
    const result = await clozeFetch(toolCtx, "/people/find", "cloze_token");
    assert.equal(result.status, 404);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "https://api.cloze.com/v1/people/find");
    assert.equal(fetchCalls[0].auth, "Bearer cloze_token");
    assert.equal(gateCalls.length, 2, "claim and release should both run");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callSlackMcpTool performs handshake and returns tool content", async () => {
  const { toolCtx, gateCalls } = buildGatedToolCtx();
  const originalFetch = globalThis.fetch;
  const requests: Array<{ session: string | null; body: any }> = [];

  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(String(init.body));
    requests.push({ session: headers["Mcp-Session-Id"] ?? null, body });

    if (body.method === "initialize") {
      return jsonResponse(200, { jsonrpc: "2.0", id: body.id, result: {} }, {
        "content-type": "application/json",
        "mcp-session-id": "session_1",
      });
    }
    if (body.method === "notifications/initialized") {
      return jsonResponse(202, null);
    }
    if (body.method === "tools/call") {
      return jsonResponse(200, {
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: "sent" }] },
      }, { "content-type": "application/json" });
    }
    throw new Error(`Unexpected Slack request: ${body.method}`);
  }) as any;

  try {
    const result = await callSlackMcpTool(
      toolCtx,
      "slack_token",
      "slack_send_message",
      { channel_id: "C1", text: "hello" },
    );

    assert.deepEqual(result, { content: [{ type: "text", text: "sent" }] });
    assert.deepEqual(requests.map((request) => request.body.method), [
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);
    assert.equal(requests[2].session, "session_1");
    assert.equal(gateCalls.length, 4, "initialize and tools/call are gated with claim/release");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callSlackMcpTool returns actionable missing-scope tool errors", async () => {
  const { toolCtx } = buildGatedToolCtx();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.method === "initialize") {
      return jsonResponse(200, { jsonrpc: "2.0", id: body.id, result: {} }, {
        "content-type": "application/json",
      });
    }
    if (body.method === "notifications/initialized") {
      return jsonResponse(202, null);
    }
    return jsonResponse(200, {
      jsonrpc: "2.0",
      id: body.id,
      error: {
        code: -32000,
        message: "missing_scope",
        data: "missing_scope: channels:read",
      },
    }, { "content-type": "application/json" });
  }) as any;

  try {
    const result = await callSlackMcpTool(toolCtx, "slack_token", "slack_list_channels", {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text ?? "", /reconnect Slack/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
