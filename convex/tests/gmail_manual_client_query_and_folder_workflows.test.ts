import assert from "node:assert/strict";
import test from "node:test";

import { ImapFlow } from "imapflow";

import {
  listGmailManualLabels,
  listGmailManualMessages,
  moveGmailManualMessages,
} from "../tools/google/gmail_manual_client";

const credentials = { email: "me@example.com", appPassword: "app-pass" };

function patchImap(methods: Record<string, unknown>) {
  const originals = new Map<string, unknown>();
  for (const [name, value] of Object.entries(methods)) {
    originals.set(name, (ImapFlow.prototype as any)[name]);
    (ImapFlow.prototype as any)[name] = value;
  }
  return () => {
    for (const [name, value] of originals) {
      (ImapFlow.prototype as any)[name] = value;
    }
  };
}

test("manual Gmail search parses Gmail query syntax and renders HTML-only messages", async () => {
  let capturedCriteria: Record<string, unknown> | undefined;
  let selectedIds: number[] = [];
  const restore = patchImap({
    connect: async () => undefined,
    logout: async () => undefined,
    getMailboxLock: async () => ({ release: () => undefined }),
    search: async (criteria: Record<string, unknown>) => {
      capturedCriteria = criteria;
      return [10, 11, 12];
    },
    fetch: async function* (ids: number[], options: Record<string, unknown>) {
      selectedIds = ids;
      assert.equal(options.source, true);
      assert.equal(options.bodyStructure, false);
      yield {
        uid: 12,
        threadId: "thread_12",
        source: Buffer.from([
          "Subject: Ignored by envelope",
          "Content-Type: text/html; charset=utf-8",
          "",
          "<p>Hello <strong>world</strong></p>",
        ].join("\r\n")),
        envelope: {
          subject: "Quarterly Plan",
          from: [{ address: "boss@example.com" }],
          to: [{ name: "Me" }],
          date: new Date("2026-05-13T09:00:00Z"),
        },
        flags: new Set(),
        labels: ["Project", 7],
      };
    },
  });

  try {
    const messages = await listGmailManualMessages(credentials, {
      query: 'from:boss@example.com to:me@example.com subject:"Quarterly Plan" after:2026/05/01 before:2026-05-12 is:unread is:starred budget',
      maxResults: 2,
      includeBody: true,
    });

    assert.equal(capturedCriteria?.from, "boss@example.com");
    assert.equal(capturedCriteria?.to, "me@example.com");
    assert.equal(capturedCriteria?.subject, "Quarterly Plan");
    assert.deepEqual(capturedCriteria?.since, new Date("2026-05-01"));
    assert.deepEqual(capturedCriteria?.before, new Date("2026-05-12"));
    assert.equal(capturedCriteria?.seen, false);
    assert.equal(capturedCriteria?.flagged, true);
    assert.equal(capturedCriteria?.body, "budget");
    assert.deepEqual(selectedIds, [12, 11]);
    assert.equal(messages[0]?.threadId, "thread_12");
    assert.equal(messages[0]?.from, "boss@example.com");
    assert.equal(messages[0]?.to, "Me");
    assert.equal(messages[0]?.body, "Hello world");
    assert.deepEqual(messages[0]?.labels, ["Project", "7"]);
  } finally {
    restore();
  }
});

test("manual Gmail folder moves normalize destinations, preserve per-message errors, and list labels", async () => {
  const destinations: string[] = [];
  const restore = patchImap({
    connect: async () => undefined,
    logout: async () => undefined,
    getMailboxLock: async () => ({ release: () => undefined }),
    messageMove: async (id: number, destination: string) => {
      destinations.push(destination);
      if (id === 22) throw "move rejected";
    },
    list: async () => [
      { path: "INBOX", name: "Inbox" },
      { path: "[Gmail]/Sent Mail", name: "Sent" },
      { path: "Customers", name: "Customers" },
    ],
  });

  try {
    const blankDestination = await moveGmailManualMessages(credentials, ["21", "22"], "   ");
    const spamDestination = await moveGmailManualMessages(credentials, ["23"], "SPAM");
    const allMailDestination = await moveGmailManualMessages(credentials, ["24"], "ALL_MAIL");
    const labels = await listGmailManualLabels(credentials);

    assert.deepEqual(blankDestination, [
      { id: "21", success: true },
      { id: "22", success: false, error: "move rejected" },
    ]);
    assert.deepEqual(spamDestination, [{ id: "23", success: true }]);
    assert.deepEqual(allMailDestination, [{ id: "24", success: true }]);
    assert.deepEqual(destinations, ["INBOX", "INBOX", "[Gmail]/Spam", "[Gmail]/All Mail"]);
    assert.deepEqual(labels, [
      { id: "INBOX", name: "Inbox", type: "system" },
      { id: "[Gmail]/Sent Mail", name: "Sent", type: "system" },
      { id: "Customers", name: "Customers", type: "user" },
    ]);
  } finally {
    restore();
  }
});
