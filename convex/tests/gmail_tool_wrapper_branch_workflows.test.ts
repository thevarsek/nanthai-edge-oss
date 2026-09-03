import assert from "node:assert/strict";
import test from "node:test";

import { ImapFlow } from "imapflow";

import {
  gmailCreateDraft,
  gmailDelete,
  gmailListLabels,
  gmailModifyLabels,
  gmailRead,
  gmailSearch,
  gmailSend,
} from "../tools/google/gmail";

function toolCtx() {
  return {
    userId: "user_1",
    ctx: {
      runQuery: async () => ({
        status: "active",
        email: "me@example.com",
        accessToken: "app-pass",
      }),
    },
  } as any;
}

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

test("Gmail tool wrappers validate required send, draft, and delete arguments", async () => {
  const send = await gmailSend.execute(toolCtx(), { to: "", subject: "Hi", body: "Body" });
  const draft = await gmailCreateDraft.execute(toolCtx(), { to: "you@example.com", subject: "", body: "Body" });
  const deleted = await gmailDelete.execute(toolCtx(), { message_ids: [] });

  assert.equal(send.success, false);
  assert.match(String(send.error), /Missing/);
  assert.equal(draft.success, false);
  assert.match(String(draft.error), /Missing/);
  assert.equal(deleted.success, false);
  assert.match(String(deleted.error), /message_ids/);
});

test("Gmail draft and label wrappers expose manual IMAP results without requiring Gmail REST IDs", async () => {
  const appended: Array<{ mailbox: string; flags: string[] }> = [];
  const restore = patchImap({
    connect: async () => undefined,
    logout: async () => undefined,
    list: async () => [
      { path: "DRAFTS", name: "DRAFTS" },
      { path: "Clients", name: "Clients" },
    ],
    append: async (mailbox: string, _message: Buffer, flags: string[]) => {
      appended.push({ mailbox, flags });
      return { id: "imap-append-id-without-uid" };
    },
  });

  try {
    const draft = await gmailCreateDraft.execute(toolCtx(), {
      to: "client@example.com",
      subject: "Proposal",
      body: "<p>Draft body</p>",
      is_html: true,
      cc: " manager@example.com ",
    });
    const labels = await gmailListLabels.execute(toolCtx(), {});
    const noOpLabels = await gmailModifyLabels.execute(toolCtx(), {
      message_ids: ["1"],
      add_labels: [],
      remove_labels: [],
    });

    assert.equal(draft.success, true);
    assert.equal((draft.data as any).draftId, null);
    assert.equal((draft.data as any).mailbox, "[Gmail]/Drafts");
    assert.deepEqual(appended, [{ mailbox: "[Gmail]/Drafts", flags: ["\\Draft"] }]);
    assert.equal(labels.success, true);
    assert.equal((labels.data as any).resultCount, 2);
    assert.equal((labels.data as any).labels[0].type, "user");
    assert.equal(noOpLabels.success, false);
    assert.match(String(noOpLabels.error), /At least one/);
  } finally {
    restore();
  }
});

test("Gmail read and search wrappers clamp limits and return message summaries", async () => {
  const fetchSelections: number[][] = [];
  const restore = patchImap({
    connect: async () => undefined,
    logout: async () => undefined,
    getMailboxLock: async () => ({ release: () => undefined }),
    search: async () => [1, 2, 3],
    fetch: async function* (ids: number[]) {
      fetchSelections.push(ids);
      for (const id of ids) {
        yield {
          uid: id,
          envelope: {
            subject: `Subject ${id}`,
            from: [{ address: `sender${id}@example.com` }],
          },
          flags: new Set(["\\Seen"]),
        };
      }
    },
  });

  try {
    const read = await gmailRead.execute(toolCtx(), {
      max_results: 99,
      include_body: false,
    });
    const search = await gmailSearch.execute(toolCtx(), {
      query: "from:sender@example.com",
      max_results: 1,
    });

    assert.equal(read.success, true);
    assert.equal((read.data as any).resultCount, 3);
    assert.equal(search.success, true);
    assert.equal((search.data as any).resultCount, 1);
    assert.deepEqual(fetchSelections, [[3, 2, 1], [3]]);
  } finally {
    restore();
  }
});

test("Gmail delete and label wrappers summarize partial and complete batch failures", async () => {
  const restore = patchImap({
    connect: async () => undefined,
    logout: async () => undefined,
    list: async () => [
      { path: "[Gmail]/Trash", specialUse: "\\Trash" },
      { path: "[Gmail]/All Mail", specialUse: "\\All" },
    ],
    getMailboxLock: async () => ({ release: () => undefined }),
    messageMove: async (id: number) => {
      if (id !== 1) throw new Error(`move ${id} failed`);
      return { uidMap: new Map([[id, id]]) };
    },
    messageFlagsAdd: async () => undefined,
    messageFlagsRemove: async () => undefined,
    messageLabelsAdd: async () => undefined,
    messageLabelsRemove: async (id: number) => {
      throw `label ${id} failed`;
    },
  });

  try {
    const partialDelete = await gmailDelete.execute(toolCtx(), {
      message_ids: ["1", "2"],
    });
    assert.equal(partialDelete.success, true);
    assert.equal((partialDelete.data as any).trashedCount, 1);
    assert.equal((partialDelete.data as any).failedCount, 1);

    const allFailedDelete = await gmailDelete.execute(toolCtx(), {
      message_ids: ["2", "3"],
    });
    assert.equal(allFailedDelete.success, false);
    assert.match(String(allFailedDelete.error), /All 2/);

    const labels = await gmailModifyLabels.execute(toolCtx(), {
      message_ids: ["4"],
      add_labels: [],
      remove_labels: ["Project"],
    });
    assert.equal(labels.success, false);
    assert.equal((labels.data as any).updatedCount, 0);
    assert.equal((labels.data as any).failedCount, 1);
    assert.equal((labels.data as any).failures[0].error, "label 4 failed");
  } finally {
    restore();
  }
});

test("Gmail wrappers preserve draft uid and all-success label updates", async () => {
  const restore = patchImap({
    connect: async () => undefined,
    logout: async () => undefined,
    append: async () => ({ uid: 42 }),
    getMailboxLock: async () => ({ release: () => undefined }),
    messageFlagsAdd: async () => undefined,
    messageFlagsRemove: async () => undefined,
    messageLabelsAdd: async () => undefined,
    messageLabelsRemove: async () => undefined,
  });

  try {
    const draft = await gmailCreateDraft.execute(toolCtx(), {
      to: "draft@example.com",
      subject: "Draft",
      body: "Draft body",
    });
    const labels = await gmailModifyLabels.execute(toolCtx(), {
      message_ids: ["5", "6"],
      add_labels: ["STARRED"],
      remove_labels: ["UNREAD"],
    });

    assert.equal(draft.success, true);
    assert.equal((draft.data as any).draftId, "42");
    assert.equal(labels.success, true);
    assert.equal((labels.data as any).updatedCount, 2);
    assert.equal((labels.data as any).failedCount, undefined);
  } finally {
    restore();
  }
});

test("Gmail draft transport failures propagate for operation reconciliation", async () => {
  const restore = patchImap({
    connect: async () => undefined,
    logout: async () => undefined,
    list: async () => [{ path: "[Gmail]/Drafts", specialUse: "\\Drafts" }],
    append: async () => {
      throw new Error("IMAP connection lost after append");
    },
  });

  try {
    await assert.rejects(
      () => gmailCreateDraft.execute(toolCtx(), {
        to: "draft@example.com",
        subject: "Draft",
        body: "Draft body",
      }),
      /IMAP connection lost after append/,
    );
  } finally {
    restore();
  }
});

test("Gmail wrapper errors preserve thrown non-Error values", async () => {
  const disconnected = await gmailRead.execute({
    userId: "user_1",
    ctx: {
      runQuery: async () => {
        throw "manual credentials unavailable";
      },
    },
  } as any, {});

  assert.equal(disconnected.success, false);
  assert.equal(disconnected.error, "manual credentials unavailable");
});
