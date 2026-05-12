import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import {
  clozeFetch,
  clozeHeaders,
  validateClozeApiKey,
} from "../tools/cloze/client";
import {
  createGmailManualDraft,
  getGmailManualCredentials,
  listGmailManualLabels,
  listGmailManualMessages,
  modifyGmailManualLabels,
  moveGmailManualMessages,
  sendGmailManualMail,
  trashGmailManualMessages,
  validateGmailManualCredentials,
} from "../tools/google/gmail_manual_client";
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

test("manual Gmail IMAP and SMTP workflows validate, draft, list, move, label, and send mail", async () => {
  const credentials = { email: "me@example.com", appPassword: "app-pass" };
  const calls: string[] = [];
  const sentMail: Array<Record<string, unknown>> = [];
  const appended: Array<{ mailbox: string; body: string; flags: string[] }> = [];
  const originals = {
    connect: (ImapFlow.prototype as any).connect,
    mailboxOpen: (ImapFlow.prototype as any).mailboxOpen,
    logout: (ImapFlow.prototype as any).logout,
    list: (ImapFlow.prototype as any).list,
    append: (ImapFlow.prototype as any).append,
    getMailboxLock: (ImapFlow.prototype as any).getMailboxLock,
    search: (ImapFlow.prototype as any).search,
    fetch: (ImapFlow.prototype as any).fetch,
    messageMove: (ImapFlow.prototype as any).messageMove,
    messageFlagsRemove: (ImapFlow.prototype as any).messageFlagsRemove,
    messageFlagsAdd: (ImapFlow.prototype as any).messageFlagsAdd,
    messageLabelsAdd: (ImapFlow.prototype as any).messageLabelsAdd,
    messageLabelsRemove: (ImapFlow.prototype as any).messageLabelsRemove,
    createTransport: nodemailer.createTransport,
  };

  try {
    (ImapFlow.prototype as any).connect = async () => {
      calls.push("connect");
    };
    (ImapFlow.prototype as any).mailboxOpen = async (mailbox: string) => {
      calls.push(`mailboxOpen:${mailbox}`);
    };
    (ImapFlow.prototype as any).logout = async () => {
      calls.push("logout");
    };
    (ImapFlow.prototype as any).list = async (options?: Record<string, unknown>) => {
      calls.push(options?.specialUse ? "list:special" : "list:all");
      return options?.specialUse
        ? [
            { path: "[Gmail]/Drafts", name: "Drafts", specialUse: "\\Drafts" },
            { path: "[Gmail]/Trash", name: "Trash", specialUse: ["\\Trash"] },
            { path: "[Gmail]/All Mail", name: "All Mail", specialUse: ["\\All"] },
          ]
        : [
            { path: "INBOX", name: "Inbox" },
            { path: "Projects", name: "Projects" },
          ];
    };
    (ImapFlow.prototype as any).append = async (mailbox: string, body: Buffer, flags: string[]) => {
      appended.push({ mailbox, body: body.toString("utf8"), flags });
      return { uid: 42, id: "draft_msg_1" };
    };
    (ImapFlow.prototype as any).getMailboxLock = async (mailbox: string) => {
      calls.push(`lock:${mailbox}`);
      return { release: () => calls.push(`release:${mailbox}`) };
    };
    (ImapFlow.prototype as any).search = async (criteria: Record<string, unknown>) => {
      calls.push(`search:${JSON.stringify(criteria)}`);
      return [11, 12, 13];
    };
    (ImapFlow.prototype as any).fetch = async function* (ids: number[], options: Record<string, unknown>) {
      calls.push(`fetch:${ids.join(",")}:${String(options.source)}`);
      yield {
        uid: 13,
        threadId: "thread_13",
        envelope: {
          subject: "Hello",
          from: [{ address: "ada@example.com" }],
          to: [{ address: "me@example.com" }],
          date: new Date("2026-05-12T10:00:00Z"),
        },
        flags: new Set<string>(),
        labels: ["Inbox"],
        source: Buffer.from("From: ada@example.com\r\nSubject: Hello\r\n\r\nPlain body"),
      };
    };
    (ImapFlow.prototype as any).messageMove = async (id: number, destination: string) => {
      calls.push(`move:${id}:${destination}`);
      if (id === 404) throw new Error("message missing");
      return { uidMap: new Map([[id, id + 1000]]) };
    };
    (ImapFlow.prototype as any).messageFlagsRemove = async (id: number, flags: string[]) => {
      calls.push(`flagsRemove:${id}:${flags.join(",")}`);
    };
    (ImapFlow.prototype as any).messageFlagsAdd = async (id: number, flags: string[]) => {
      calls.push(`flagsAdd:${id}:${flags.join(",")}`);
    };
    (ImapFlow.prototype as any).messageLabelsAdd = async (id: number, labels: string[]) => {
      calls.push(`labelsAdd:${id}:${labels.join(",")}`);
    };
    (ImapFlow.prototype as any).messageLabelsRemove = async (id: number, labels: string[]) => {
      calls.push(`labelsRemove:${id}:${labels.join(",")}`);
    };
    (nodemailer as any).createTransport = () => ({
      verify: async () => {
        calls.push("smtpVerify");
      },
      sendMail: async (message: Record<string, unknown>) => {
        sentMail.push(message);
        return { messageId: "smtp_msg_1" };
      },
    });

    await validateGmailManualCredentials(credentials);
    const sent = await sendGmailManualMail(credentials, {
      to: "you@example.com",
      cc: "cc@example.com",
      bcc: "bcc@example.com",
      subject: "Line\r\nBreak",
      body: "<b>Hello</b>",
      isHtml: true,
    });
    const draft = await createGmailManualDraft(credentials, {
      to: "you@example.com",
      subject: "Draft\r\nSubject",
      body: "Line 1\nLine 2",
      cc: " cc@example.com ",
    });
    const messages = await listGmailManualMessages(credentials, {
      query: 'from:ada@example.com subject:"Hello" after:2026/05/01 is:unread body words',
      maxResults: 2,
      includeBody: true,
    });
    const trashed = await trashGmailManualMessages(credentials, ["13", "404"]);
    const moved = await moveGmailManualMessages(credentials, ["13"], "TRASH");
    const labeled = await modifyGmailManualLabels(
      credentials,
      ["13"],
      ["UNREAD", "STARRED", "TRASH", "Project"],
      ["UNREAD", "STARRED", "INBOX", "Project"],
    );
    const labels = await listGmailManualLabels(credentials);

    assert.equal((sent as any).messageId, "smtp_msg_1");
    assert.equal(sentMail[0]?.html, "<b>Hello</b>");
    assert.equal(sentMail[0]?.text, undefined);
    assert.equal(draft.mailbox, "[Gmail]/Drafts");
    assert.equal(draft.uid, 42);
    assert.ok(appended[0]?.body.includes("Subject: Draft Subject"));
    assert.deepEqual(appended[0]?.flags, ["\\Draft"]);
    assert.equal(messages[0]?.id, "13");
    assert.equal(messages[0]?.snippet, "Plain body");
    assert.deepEqual(trashed, [
      { id: "13", success: true },
      { id: "404", success: false, error: "message missing" },
    ]);
    assert.deepEqual(moved, [{ id: "13", success: true }]);
    assert.deepEqual(labeled, [{ id: "13", success: true }]);
    assert.deepEqual(labels, [
      { id: "INBOX", name: "Inbox", type: "system" },
      { id: "Projects", name: "Projects", type: "user" },
    ]);
    assert.ok(calls.some((call) => call.includes('"from":"ada@example.com"')));
    assert.ok(calls.includes("move:13:[Gmail]/Trash"));
    assert.ok(calls.includes("flagsRemove:13:\\Seen"));
    assert.ok(calls.includes("flagsAdd:13:\\Seen"));
    assert.ok(calls.includes("labelsAdd:13:Project"));
    assert.ok(calls.includes("labelsRemove:13:Project"));
  } finally {
    (ImapFlow.prototype as any).connect = originals.connect;
    (ImapFlow.prototype as any).mailboxOpen = originals.mailboxOpen;
    (ImapFlow.prototype as any).logout = originals.logout;
    (ImapFlow.prototype as any).list = originals.list;
    (ImapFlow.prototype as any).append = originals.append;
    (ImapFlow.prototype as any).getMailboxLock = originals.getMailboxLock;
    (ImapFlow.prototype as any).search = originals.search;
    (ImapFlow.prototype as any).fetch = originals.fetch;
    (ImapFlow.prototype as any).messageMove = originals.messageMove;
    (ImapFlow.prototype as any).messageFlagsRemove = originals.messageFlagsRemove;
    (ImapFlow.prototype as any).messageFlagsAdd = originals.messageFlagsAdd;
    (ImapFlow.prototype as any).messageLabelsAdd = originals.messageLabelsAdd;
    (ImapFlow.prototype as any).messageLabelsRemove = originals.messageLabelsRemove;
    (nodemailer as any).createTransport = originals.createTransport;
  }
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

test("validateClozeApiKey reports unauthorized and non-ok Cloze responses", async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    jsonResponse(401, { error: "unauthorized" }),
    jsonResponse(500, { error: "server" }),
    jsonResponse(200, { email: "raw@example.com", name: "Raw Name" }),
  ];
  let callCount = 0;
  globalThis.fetch = (async () => responses[callCount++]) as any;

  try {
    await assert.rejects(
      validateClozeApiKey("bad_key"),
      /unauthorized/,
    );
    await assert.rejects(
      validateClozeApiKey("server_key"),
      /Cloze API error 500/,
    );
    assert.deepEqual(await validateClozeApiKey("raw_key"), {
      email: "raw@example.com",
      displayName: "Raw Name",
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

test("clozeFetch waits for gates, retries retryable responses, and releases failed attempts", async () => {
  const gateCalls: Array<Record<string, unknown>> = [];
  let claimCount = 0;
  const toolCtx = {
    userId: "user_1",
    ctx: {
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        gateCalls.push(args);
        if ("leaseMs" in args) {
          claimCount += 1;
          return claimCount === 1
            ? { granted: false, waitMs: 1 }
            : { granted: true, waitMs: 0 };
        }
        return undefined;
      },
    },
  } as any;
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    return fetchCount === 1
      ? jsonResponse(429, { error: "slow down" }, { "retry-after": "0" })
      : jsonResponse(200, { ok: true });
  }) as any;

  try {
    const response = await clozeFetch(toolCtx, "https://api.cloze.com/v1/user/profile", "token");
    assert.equal(response.status, 200);
    assert.equal(fetchCount, 2);
    assert.ok(gateCalls.some((call) => call.lastResponseStatus === 429));
    assert.ok(gateCalls.some((call) => call.lastResponseStatus === 200));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("clozeFetch retries thrown fetches and rethrows the final failure", async () => {
  const { toolCtx, gateCalls } = buildGatedToolCtx();
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    throw new Error(`network ${fetchCount}`);
  }) as any;

  try {
    await assert.rejects(
      clozeFetch(toolCtx, "/people/find", "token"),
      /network 5/,
    );
    assert.equal(fetchCount, 5);
    assert.equal(gateCalls.filter((call) => "lastResponseStatus" in call).length, 5);
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
