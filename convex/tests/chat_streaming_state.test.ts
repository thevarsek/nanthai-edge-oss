import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteStreamingMessage,
  getStreamingMessageByMessageId,
  isTerminalMessageStatus,
  mergeStreamingMessageRecords,
  patchStreamingMessageStatus,
  pickPrimaryStreamingMessage,
  splitStreamingMessageRecords,
  upsertStreamingMessage,
} from "../chat/streaming_state";

function createCtx() {
  const rows = new Map<string, any>();
  let nextId = 0;

  return {
    rows,
    ctx: {
      db: {
        query: (table: string) => ({
          withIndex: (_index: string, builder: (q: { eq: (field: string, value: unknown) => { field: string; value: unknown } }) => { field: string; value: unknown }) => ({
            first: async () => {
              const match = builder({
                eq: (field: string, value: unknown) => ({ field, value }),
              });
              for (const row of rows.values()) {
                if (table === "streamingMessages" && row[match.field] === match.value) {
                  return row;
                }
              }
              return null;
            },
            collect: async () => {
              const match = builder({
                eq: (field: string, value: unknown) => ({ field, value }),
              });
              return [...rows.values()].filter((row) => table === "streamingMessages" && row[match.field] === match.value);
            },
          }),
        }),
        insert: async (_table: string, value: Record<string, unknown>) => {
          const id = `stream_${++nextId}`;
          rows.set(id, { _id: id, ...value });
          return id;
        },
        patch: async (id: string, value: Record<string, unknown>) => {
          rows.set(id, { ...rows.get(id), ...value });
        },
        delete: async (id: string) => {
          rows.delete(id);
        },
      },
    } as any,
  };
}

test("upsertStreamingMessage inserts and updates by messageId", async () => {
  const { ctx, rows } = createCtx();
  const message = {
    _id: "msg_1",
    chatId: "chat_1",
    status: "pending",
  } as any;

  await upsertStreamingMessage(ctx, message, {
    content: "Hello",
    status: "streaming",
  });

  assert.equal(rows.size, 1);
  const inserted = await getStreamingMessageByMessageId(ctx, "msg_1" as any);
  assert.equal(inserted?.content, "Hello");
  assert.equal(inserted?.status, "streaming");

  await upsertStreamingMessage(ctx, message, {
    reasoning: "Thinking",
  });

  assert.equal(rows.size, 1);
  const updated = await getStreamingMessageByMessageId(ctx, "msg_1" as any);
  assert.equal(updated?.content, "Hello");
  assert.equal(updated?.reasoning, "Thinking");
});

test("patchStreamingMessageStatus updates status without deleting content", async () => {
  const { ctx } = createCtx();
  const message = {
    _id: "msg_2",
    chatId: "chat_1",
    status: "pending",
  } as any;

  await upsertStreamingMessage(ctx, message, {
    content: "Partial",
    status: "streaming",
  });
  await patchStreamingMessageStatus(ctx, "msg_2" as any, "cancelled");

  const updated = await getStreamingMessageByMessageId(ctx, "msg_2" as any);
  assert.equal(updated?.content, "Partial");
  assert.equal(updated?.status, "cancelled");
});

test("patchStreamingMessageStatus preserves merged duplicate fallback fields", async () => {
  const { ctx, rows } = createCtx();
  rows.set("stream_content", {
    _id: "stream_content",
    messageId: "msg_status_dupe",
    chatId: "chat_1",
    content: "Partial",
    status: "streaming",
    createdAt: 1,
    updatedAt: 1,
  });
  rows.set("stream_status", {
    _id: "stream_status",
    messageId: "msg_status_dupe",
    chatId: "chat_1",
    content: "",
    reasoning: "Still thinking",
    status: "streaming",
    toolCalls: [{ id: "tool_1", name: "search", arguments: "{}" }],
    createdAt: 2,
    updatedAt: 2,
  });

  await patchStreamingMessageStatus(ctx, "msg_status_dupe" as any, "cancelled");

  const updated = await getStreamingMessageByMessageId(ctx, "msg_status_dupe" as any);
  assert.equal(updated?.content, "Partial");
  assert.equal(updated?.reasoning, "Still thinking");
  assert.deepEqual(updated?.toolCalls, [{ id: "tool_1", name: "search", arguments: "{}" }]);
  assert.equal(updated?.status, "cancelled");
  assert.deepEqual([...rows.keys()].sort(), ["stream_status"]);
});

test("deleteStreamingMessage removes the row", async () => {
  const { ctx } = createCtx();
  const message = {
    _id: "msg_3",
    chatId: "chat_1",
    status: "pending",
  } as any;

  await upsertStreamingMessage(ctx, message, {
    content: "Partial",
    status: "streaming",
  });
  await deleteStreamingMessage(ctx, "msg_3" as any);

  const missing = await getStreamingMessageByMessageId(ctx, "msg_3" as any);
  assert.equal(missing, null);
});

test("duplicate overlay rows are deduped to the newest record and removed on write", async () => {
  const { ctx, rows } = createCtx();
  rows.set("stream_old", {
    _id: "stream_old",
    messageId: "msg_dupe",
    chatId: "chat_1",
    content: "old",
    status: "streaming",
    createdAt: 1,
    updatedAt: 10,
  });
  rows.set("stream_new", {
    _id: "stream_new",
    messageId: "msg_dupe",
    chatId: "chat_1",
    content: "new",
    status: "streaming",
    createdAt: 2,
    updatedAt: 20,
  });

  const message = {
    _id: "msg_dupe",
    chatId: "chat_1",
    status: "pending",
  } as any;

  await upsertStreamingMessage(ctx, message, { reasoning: "kept" });

  const updated = await getStreamingMessageByMessageId(ctx, "msg_dupe" as any);
  assert.equal(updated?._id, "stream_new");
  assert.equal(updated?.content, "new");
  assert.equal(updated?.reasoning, "kept");
  assert.deepEqual([...rows.keys()].sort(), ["stream_new"]);
});

test("deleteStreamingMessage removes all duplicate rows for a message", async () => {
  const { ctx, rows } = createCtx();
  rows.set("stream_a", {
    _id: "stream_a",
    messageId: "msg_dupe_delete",
    chatId: "chat_1",
    content: "a",
    status: "streaming",
    createdAt: 1,
    updatedAt: 1,
  });
  rows.set("stream_b", {
    _id: "stream_b",
    messageId: "msg_dupe_delete",
    chatId: "chat_1",
    content: "b",
    status: "streaming",
    createdAt: 2,
    updatedAt: 2,
  });

  await deleteStreamingMessage(ctx, "msg_dupe_delete" as any);

  assert.equal(rows.size, 0);
});

test("pickPrimaryStreamingMessage prefers the newest updated record", () => {
  const primary = pickPrimaryStreamingMessage([
    {
      _id: "stream_1",
      messageId: "msg_1",
      chatId: "chat_1",
      content: "old",
      status: "streaming",
      createdAt: 1,
      updatedAt: 1,
    },
    {
      _id: "stream_2",
      messageId: "msg_1",
      chatId: "chat_1",
      content: "new",
      status: "streaming",
      createdAt: 2,
      updatedAt: 5,
    },
  ] as any);

  assert.equal(primary?._id, "stream_2");
});

test("splitStreamingMessageRecords separates primary from duplicates", () => {
  const result = splitStreamingMessageRecords([
    {
      _id: "stream_1",
      messageId: "msg_1",
      chatId: "chat_1",
      content: "old",
      status: "streaming",
      createdAt: 1,
      updatedAt: 1,
    },
    {
      _id: "stream_2",
      messageId: "msg_1",
      chatId: "chat_1",
      content: "new",
      status: "streaming",
      createdAt: 2,
      updatedAt: 5,
    },
  ] as any);

  assert.equal(result.primary?._id, "stream_2");
  assert.deepEqual(result.duplicates.map((record) => record._id), ["stream_1"]);
});

test("mergeStreamingMessageRecords preserves split content, reasoning, and toolCalls", () => {
  const merged = mergeStreamingMessageRecords([
    {
      _id: "stream_content",
      messageId: "msg_1",
      chatId: "chat_1",
      content: "Partial content",
      status: "streaming",
      createdAt: 1,
      updatedAt: 1,
    },
    {
      _id: "stream_reasoning",
      messageId: "msg_1",
      chatId: "chat_1",
      content: "",
      reasoning: "Reasoning trace",
      status: "streaming",
      createdAt: 2,
      updatedAt: 2,
    },
    {
      _id: "stream_tools",
      messageId: "msg_1",
      chatId: "chat_1",
      content: "",
      status: "streaming",
      toolCalls: [{ id: "tool_1", name: "search", arguments: "{}" }],
      createdAt: 3,
      updatedAt: 3,
    },
  ] as any);

  assert.equal(merged?.content, "Partial content");
  assert.equal(merged?.reasoning, "Reasoning trace");
  assert.deepEqual(merged?.toolCalls, [{ id: "tool_1", name: "search", arguments: "{}" }]);
  assert.equal(merged?.status, "streaming");
});

test("mergeStreamingMessageRecords prefers newer meaningful text over longer stale text", () => {
  const merged = mergeStreamingMessageRecords([
    {
      _id: "stream_old",
      messageId: "msg_1",
      chatId: "chat_1",
      content: "Longer stale content",
      reasoning: "Longer stale reasoning",
      status: "streaming",
      createdAt: 1,
      updatedAt: 1,
    },
    {
      _id: "stream_new",
      messageId: "msg_1",
      chatId: "chat_1",
      content: "Short fix",
      reasoning: "Short fix",
      status: "streaming",
      createdAt: 2,
      updatedAt: 2,
    },
  ] as any);

  assert.equal(merged?.content, "Short fix");
  assert.equal(merged?.reasoning, "Short fix");
});

test("isTerminalMessageStatus matches completed, failed, and cancelled", () => {
  assert.equal(isTerminalMessageStatus("pending"), false);
  assert.equal(isTerminalMessageStatus("streaming"), false);
  assert.equal(isTerminalMessageStatus("completed"), true);
  assert.equal(isTerminalMessageStatus("failed"), true);
  assert.equal(isTerminalMessageStatus("cancelled"), true);
});
