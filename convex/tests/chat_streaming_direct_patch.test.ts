import assert from "node:assert/strict";
import test from "node:test";

import {
  updateMessageContentHandler,
  updateMessageReasoningHandler,
  updateMessageToolCallsHandler,
} from "../chat/mutations_internal_handlers";

test("updateMessageToolCallsHandler falls back to upsert when streamingMessageId is absent", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const inserts: Array<Record<string, unknown>> = [];

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "msg_1") {
          return { _id: id, chatId: "chat_1", status: "streaming" };
        }
        return null;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      insert: async (_table: string, doc: Record<string, unknown>) => {
        inserts.push(doc);
        return "stream_new";
      },
      query: (_table: string) => ({
        withIndex: () => ({
          collect: async () => [],
        }),
      }),
    },
  } as any;

  await updateMessageToolCallsHandler(ctx, {
    messageId: "msg_1" as any,
    toolCalls: [{ id: "tool_1", name: "fetch_image", arguments: '{"url":"x"}' }],
  });

  // Should upsert — since no existing streaming message, it inserts.
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0]?.toolCalls, [{ id: "tool_1", name: "fetch_image", arguments: '{"url":"x"}' }]);
});

test("streaming update handlers patch the seeded overlay row directly when streamingMessageId is provided", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "msg_1") {
          return { _id: id, chatId: "chat_1", status: "pending" };
        }
        if (id === "stream_1") {
          return {
            _id: id,
            messageId: "msg_1",
            chatId: "chat_1",
            content: "",
            status: "pending",
          };
        }
        return null;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      query: () => ({
        withIndex: () => ({
          collect: async () => {
            throw new Error("should not query streamingMessages in direct patch path");
          },
        }),
      }),
    },
  } as any;

  await updateMessageContentHandler(ctx, {
    messageId: "msg_1" as any,
    streamingMessageId: "stream_1" as any,
    content: "hello",
    status: "streaming",
  });
  await updateMessageReasoningHandler(ctx, {
    messageId: "msg_1" as any,
    streamingMessageId: "stream_1" as any,
    reasoning: "thinking",
  });
  await updateMessageToolCallsHandler(ctx, {
    messageId: "msg_1" as any,
    streamingMessageId: "stream_1" as any,
    toolCalls: [{ id: "tool_1", name: "search", arguments: "{}" }],
  });

  assert.equal(patches.length, 3);
  assert.equal(patches[0]?.id, "stream_1");
  assert.equal(patches[0]?.value.content, "hello");
  assert.equal(patches[1]?.id, "stream_1");
  assert.equal(patches[1]?.value.reasoning, "thinking");
  assert.equal(patches[2]?.id, "stream_1");
  assert.deepEqual(patches[2]?.value.toolCalls, [{ id: "tool_1", name: "search", arguments: "{}" }]);
});
