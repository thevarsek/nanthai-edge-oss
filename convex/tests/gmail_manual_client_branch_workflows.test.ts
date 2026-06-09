import assert from "node:assert/strict";
import test from "node:test";

import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

import {
  createGmailManualDraft,
  getGmailManualCredentials,
  listGmailManualMessages,
  modifyGmailManualLabels,
  sendGmailManualMail,
  trashGmailManualMessages,
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

test("manual Gmail credentials return active plaintext fallback and SMTP text mode omits optional recipients", async () => {
  const resolved = await getGmailManualCredentials({
    runQuery: async () => ({
      status: "active",
      email: "me@example.com",
      accessToken: "plain-app-password",
    }),
  } as any, "user_1");
  assert.deepEqual(resolved, {
    email: "me@example.com",
    appPassword: "plain-app-password",
  });

  const originalTransport = nodemailer.createTransport;
  const sentMail: Array<Record<string, unknown>> = [];
  (nodemailer as any).createTransport = () => ({
    sendMail: async (message: Record<string, unknown>) => {
      sentMail.push(message);
      return { messageId: "smtp_text_1" };
    },
  });

  try {
    const sent = await sendGmailManualMail(credentials, {
      to: "you@example.com",
      subject: "Plain",
      body: "Plain body",
    });

    assert.equal((sent as any).messageId, "smtp_text_1");
    assert.equal(sentMail[0]?.text, "Plain body");
    assert.equal(sentMail[0]?.html, undefined);
    assert.equal(sentMail[0]?.cc, undefined);
    assert.equal(sentMail[0]?.bcc, undefined);
  } finally {
    (nodemailer as any).createTransport = originalTransport;
  }
});

test("manual Gmail draft falls back to default Drafts path and reports rejected appends", async () => {
  let appendCount = 0;
  const restore = patchImap({
    connect: async () => undefined,
    logout: async () => {
      throw new Error("logout already closed");
    },
    list: async () => {
      throw new Error("LIST special-use unavailable");
    },
    append: async (mailbox: string, body: Buffer, flags: string[]) => {
      appendCount += 1;
      assert.equal(mailbox, "[Gmail]/Drafts");
      assert.deepEqual(flags, ["\\Draft"]);
      if (appendCount === 1) {
        assert.match(body.toString("utf8"), /Subject: Draft Subject/);
      }
      return appendCount === 1 ? { uid: "not numeric", id: 123 } : false;
    },
  });

  try {
    const draft = await createGmailManualDraft(credentials, {
      to: "you@example.com",
      cc: "\r\ncc@example.com",
      bcc: "bcc@example.com\n",
      subject: "Draft\r\nSubject",
      body: "Line 1\nLine 2",
    });
    assert.deepEqual(draft, { mailbox: "[Gmail]/Drafts", uid: undefined, messageId: undefined });

    await assert.rejects(
      createGmailManualDraft(credentials, {
        to: "you@example.com",
        subject: "Rejected",
        body: "Body",
      }),
      /rejected the draft append/,
    );
  } finally {
    restore();
  }
});

test("manual Gmail listing handles empty searches, malformed ids, read flags, and missing envelope fields", async () => {
  const calls: string[] = [];
  const restore = patchImap({
    connect: async () => undefined,
    logout: async () => undefined,
    getMailboxLock: async (mailbox: string) => ({
      release: () => calls.push(`release:${mailbox}`),
    }),
    search: async (criteria: Record<string, unknown>) => {
      calls.push(JSON.stringify(criteria));
      return "not-an-array";
    },
    fetch: async function* (_ids: number[], options: Record<string, unknown>) {
      calls.push(`source:${String(options.source)}:bodyStructure:${String(options.bodyStructure)}`);
      yield {
        uid: 77,
        envelope: {
          subject: "",
          from: [{ name: "Ada Lovelace" }],
          date: undefined,
        },
        flags: new Set(["\\Seen"]),
      };
    },
  });

  try {
    const messages = await listGmailManualMessages(credentials, {
      query: "",
      maxResults: 5,
      includeBody: false,
    });

    assert.equal(messages[0]?.id, "77");
    assert.equal(messages[0]?.threadId, "77");
    assert.equal(messages[0]?.subject, "(no subject)");
    assert.equal(messages[0]?.from, "Ada Lovelace");
    assert.equal(messages[0]?.to, undefined);
    assert.equal(messages[0]?.date, undefined);
    assert.equal(messages[0]?.body, undefined);
    assert.equal(messages[0]?.isUnread, false);
    assert.deepEqual(messages[0]?.labels, []);
    assert.ok(calls.includes("{}"));
    assert.ok(calls.includes("source:false:bodyStructure:true"));
    assert.ok(calls.includes("release:INBOX"));
  } finally {
    restore();
  }
});

test("manual Gmail localized mailbox failures return per-message results without claiming success", async () => {
  const restore = patchImap({
    connect: async () => undefined,
    logout: async () => undefined,
    list: async () => [{ path: "INBOX", name: "Inbox", specialUse: undefined }],
    getMailboxLock: async () => ({ release: () => undefined }),
    messageMove: async () => ({ uidMap: new Map() }),
    messageFlagsAdd: async () => undefined,
    messageFlagsRemove: async () => undefined,
  });

  try {
    const trash = await trashGmailManualMessages(credentials, ["11", "12"]);
    assert.deepEqual(trash, [
      {
        id: "11",
        success: false,
        error: "Gmail Trash mailbox not found via SPECIAL-USE. Ensure IMAP access to All Mail is enabled in Gmail settings.",
      },
      {
        id: "12",
        success: false,
        error: "Gmail Trash mailbox not found via SPECIAL-USE. Ensure IMAP access to All Mail is enabled in Gmail settings.",
      },
    ]);

    const labelResults = await modifyGmailManualLabels(
      credentials,
      ["13", "14"],
      ["Project"],
      ["INBOX"],
    );
    assert.deepEqual(labelResults, [
      { id: "13", success: false, error: "Gmail All Mail mailbox not found via SPECIAL-USE." },
      { id: "14", success: false, error: "Gmail All Mail mailbox not found via SPECIAL-USE." },
    ]);
  } finally {
    restore();
  }
});

test("manual Gmail trash preserves nullish move response fallback", async () => {
  const movedIds: number[] = [];
  const moveResponses: Array<null | undefined | false> = [null, undefined, false];
  const restore = patchImap({
    connect: async () => undefined,
    logout: async () => undefined,
    list: async () => [{ path: "[Gmail]/Trash", name: "Trash", specialUse: "\\Trash" }],
    getMailboxLock: async () => ({ release: () => undefined }),
    messageMove: async (id: number) => {
      movedIds.push(id);
      return moveResponses.shift();
    },
  });

  try {
    const trash = await trashGmailManualMessages(credentials, ["21", "22", "23"]);
    assert.deepEqual(trash, [
      { id: "21", success: true },
      { id: "22", success: true },
      { id: "23", success: true },
    ]);
    assert.deepEqual(movedIds, [21, 22, 23]);
  } finally {
    restore();
  }
});
