import assert from "node:assert/strict";
import test from "node:test";

import {
  getStreamingContentHandler,
  listStreamingMessagesHandler,
} from "../chat/streaming_query_handlers";

test("listStreamingMessagesHandler returns only streaming overlay rows for the authorized chat", async () => {
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") return { _id: id, userId: "user_1" };
        return null;
      },
      query: (table: string) => ({
        withIndex: (_index: string, builder: (q: { eq: (field: string, value: unknown) => { field: string; value: unknown } }) => { field: string; value: unknown }) => ({
          collect: async () => {
            const match = builder({ eq: (field: string, value: unknown) => ({ field, value }) });
            assert.equal(table, "streamingMessages");
            assert.equal(match.field, "chatId");
            assert.equal(match.value, "chat_1");
            return [
              {
                _id: "stream_1",
                messageId: "msg_1",
                chatId: "chat_1",
                content: "partial",
                reasoning: "thinking",
                status: "streaming",
                toolCalls: [{ id: "tool_1", name: "search", arguments: "{}" }],
                createdAt: 1,
                updatedAt: 1,
              },
              {
                _id: "stream_2",
                messageId: "msg_1",
                chatId: "chat_1",
                content: "partial newer",
                reasoning: "thinking newer",
                status: "streaming",
                toolCalls: [{ id: "tool_2", name: "search", arguments: "{\"q\":\"new\"}" }],
                createdAt: 2,
                updatedAt: 2,
              },
            ];
          },
        }),
      }),
    },
  } as any;

  const result = await listStreamingMessagesHandler(ctx, { chatId: "chat_1" as any });

  assert.deepEqual(result, [
    {
      messageId: "msg_1",
      content: "partial newer",
      reasoning: "thinking newer",
      status: "streaming",
      toolCalls: [{ id: "tool_2", name: "search", arguments: "{\"q\":\"new\"}" }],
    },
  ]);
});

test("listStreamingMessagesHandler merges split duplicate overlay rows", async () => {
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") return { _id: id, userId: "user_1" };
        return null;
      },
      query: (table: string) => ({
        withIndex: (
          _index: string,
          builder: (q: { eq: (field: string, value: unknown) => { field: string; value: unknown } }) => { field: string; value: unknown },
        ) => ({
          collect: async () => {
            const match = builder({ eq: (field: string, value: unknown) => ({ field, value }) });
            assert.equal(table, "streamingMessages");
            assert.equal(match.field, "chatId");
            assert.equal(match.value, "chat_1");
            return [
              {
                _id: "stream_content",
                messageId: "msg_1",
                chatId: "chat_1",
                content: "split content",
                status: "streaming",
                createdAt: 1,
                updatedAt: 1,
              },
              {
                _id: "stream_reasoning",
                messageId: "msg_1",
                chatId: "chat_1",
                content: "",
                reasoning: "split reasoning",
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
                toolCalls: [{ id: "tool_3", name: "lookup", arguments: "{}" }],
                createdAt: 3,
                updatedAt: 3,
              },
            ];
          },
        }),
      }),
    },
  } as any;

  const result = await listStreamingMessagesHandler(ctx, { chatId: "chat_1" as any });

  assert.deepEqual(result, [
    {
      messageId: "msg_1",
      content: "split content",
      reasoning: "split reasoning",
      status: "streaming",
      toolCalls: [{ id: "tool_3", name: "lookup", arguments: "{}" }],
    },
  ]);
});

test("getStreamingContentHandler prefers streaming overlay content over persisted message content", async () => {
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "msg_1") {
          return {
            _id: id,
            chatId: "chat_1",
            content: "persisted",
            reasoning: undefined,
            status: "pending",
            modelId: "openai/gpt-4.1",
            participantName: "Assistant",
            toolCalls: [],
            usage: undefined,
          };
        }
        if (id === "chat_1") return { _id: id, userId: "user_1" };
        return null;
      },
      query: (table: string) => ({
        withIndex: (
          _index: string,
          builder: (q: { eq: (field: string, value: unknown) => { field: string; value: unknown } }) => { field: string; value: unknown },
        ) => ({
          collect: async () => {
            const match = builder({ eq: (field: string, value: unknown) => ({ field, value }) });
            assert.equal(table, "streamingMessages");
            assert.equal(match.field, "messageId");
            assert.equal(match.value, "msg_1");
            return [
              {
                _id: "stream_1",
                messageId: "msg_1",
                chatId: "chat_1",
                content: "streaming content",
                reasoning: "live reasoning",
                status: "streaming",
                toolCalls: [{ id: "tool_1", name: "search", arguments: "{}" }],
                createdAt: 1,
                updatedAt: 1,
              },
            ];
          },
          first: async () => {
            const match = builder({ eq: (field: string, value: unknown) => ({ field, value }) });
            assert.equal(table, "streamingMessages");
            assert.equal(match.field, "messageId");
            assert.equal(match.value, "msg_1");
            return {
              _id: "stream_1",
              messageId: "msg_1",
              chatId: "chat_1",
              content: "streaming content",
              reasoning: "live reasoning",
              status: "streaming",
              toolCalls: [{ id: "tool_1", name: "search", arguments: "{}" }],
            };
          },
        }),
      }),
    },
  } as any;

  const result = await getStreamingContentHandler(ctx, { messageId: "msg_1" as any });

  assert.deepEqual(result, {
    content: "streaming content",
    reasoning: "live reasoning",
    status: "streaming",
    modelId: "openai/gpt-4.1",
    participantName: "Assistant",
    toolCalls: [{ id: "tool_1", name: "search", arguments: "{}" }],
    usage: undefined,
  });
});
