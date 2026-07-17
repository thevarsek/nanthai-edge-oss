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
        if (id === "msg_1") return { _id: id, chatId: "chat_1", status: "streaming" };
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
      toolResults: undefined,
      activeToolCallIds: undefined,
      updatedAt: 2,
      presentationProgress: undefined,
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
        if (id === "msg_1") return { _id: id, chatId: "chat_1", status: "pending" };
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
      toolResults: undefined,
      activeToolCallIds: undefined,
      updatedAt: 3,
      presentationProgress: undefined,
    },
  ]);
});

test("listStreamingMessagesHandler ignores stale overlays once the base message is terminal", async () => {
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") return { _id: id, userId: "user_1" };
        if (id === "msg_1") return { _id: id, chatId: "chat_1", status: "completed" };
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
                _id: "stream_1",
                messageId: "msg_1",
                chatId: "chat_1",
                content: "stale streaming content",
                status: "streaming",
                createdAt: 1,
                updatedAt: 1,
              },
            ];
          },
        }),
      }),
    },
  } as any;

  const result = await listStreamingMessagesHandler(ctx, { chatId: "chat_1" as any });

  assert.deepEqual(result, []);
});

test("listStreamingMessagesHandler preserves terminal overlays for cancelled partial content", async () => {
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") return { _id: id, userId: "user_1" };
        if (id === "msg_1") return { _id: id, chatId: "chat_1", status: "cancelled" };
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
                _id: "stream_1",
                messageId: "msg_1",
                chatId: "chat_1",
                content: "partial before cancel",
                status: "cancelled",
                createdAt: 1,
                updatedAt: 1,
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
      content: "partial before cancel",
      reasoning: undefined,
      status: "cancelled",
      toolCalls: undefined,
      toolResults: undefined,
      activeToolCallIds: undefined,
      updatedAt: 1,
      presentationProgress: undefined,
    },
  ]);
});

test("listStreamingMessagesHandler exposes authoritative presentation progress and failure results", async () => {
  const streaming = [{
    _id: "stream_1",
    messageId: "msg_1",
    chatId: "chat_1",
    content: "",
    status: "streaming",
    toolCalls: [
      { id: "call_failed", name: "create_presentation", arguments: "{}" },
      { id: "call_active", name: "create_presentation", arguments: "{}" },
    ],
    createdAt: 1,
    updatedAt: 2,
  }];
  const projects = [
    {
      originToolCallId: "call_active",
      title: "Quarterly plan",
      status: "generating",
      workflowPhase: "repairing_generation",
      plan: [{ id: "slide-1" }, { id: "slide-2" }],
      updatedAt: 8,
    },
    {
      originToolCallId: "call_failed",
      title: "Earlier attempt",
      status: "failed",
      workflowPhase: "failed",
      error: "Invalid slide HTML.",
      updatedAt: 4,
    },
  ];
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") return { _id: id, userId: "user_1" };
        if (id === "msg_1") return { _id: id, chatId: "chat_1", status: "streaming" };
        return null;
      },
      query: (table: string) => ({
        withIndex: () => table === "streamingMessages"
          ? { collect: async () => streaming }
          : { order: () => ({ take: async () => projects }) },
      }),
    },
  } as any;

  const [result] = await listStreamingMessagesHandler(ctx, { chatId: "chat_1" as any });

  assert.deepEqual(result?.activeToolCallIds, ["call_active"]);
  assert.equal(result?.toolResults?.[0]?.toolCallId, "call_failed");
  assert.equal(result?.toolResults?.[0]?.isError, true);
  assert.deepEqual(result?.presentationProgress, {
    phase: "repairing_generation",
    progress: 0.76,
    title: "Quarterly plan",
    slideCount: 2,
    error: undefined,
  });
  assert.equal(result?.updatedAt, 8);
});

test("failed presentation progress stops at the last durable repair phase", async () => {
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") return { _id: id, userId: "user_1" };
        if (id === "msg_1") return { _id: id, chatId: "chat_1", status: "streaming" };
        return null;
      },
      query: (table: string) => ({
        withIndex: () => table === "streamingMessages"
          ? {
            collect: async () => [{
              _id: "stream_1",
              messageId: "msg_1",
              chatId: "chat_1",
              content: "",
              status: "streaming",
              toolCalls: [{ id: "call_1", name: "create_presentation", arguments: "{}" }],
              createdAt: 1,
              updatedAt: 2,
            }],
          }
          : {
            order: () => ({
              take: async () => [{
                originToolCallId: "call_1",
                title: "Failed deck",
                status: "failed",
                workflowPhase: "failed",
                plan: [{ id: "slide_1" }],
                error: "Slide layout was invalid.",
                updatedAt: 4,
              }],
            }),
          },
      }),
    },
  } as any;

  const [result] = await listStreamingMessagesHandler(ctx, { chatId: "chat_1" as any });

  assert.equal(result?.presentationProgress?.phase, "failed");
  assert.equal(result?.presentationProgress?.progress, 0.76);
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

test("getStreamingContentHandler returns the persisted terminal message when a stale overlay remains", async () => {
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
            content: "final content",
            reasoning: "final reasoning",
            status: "completed",
            modelId: "openai/gpt-4.1",
            participantName: "Assistant",
            toolCalls: [{ id: "tool_final", name: "final", arguments: "{}" }],
            usage: { totalTokens: 12 },
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
                content: "stale overlay content",
                reasoning: "stale reasoning",
                status: "streaming",
                toolCalls: [{ id: "tool_stale", name: "stale", arguments: "{}" }],
                createdAt: 1,
                updatedAt: 1,
              },
            ];
          },
        }),
      }),
    },
  } as any;

  const result = await getStreamingContentHandler(ctx, { messageId: "msg_1" as any });

  assert.deepEqual(result, {
    content: "final content",
    reasoning: "final reasoning",
    status: "completed",
    modelId: "openai/gpt-4.1",
    participantName: "Assistant",
    toolCalls: [{ id: "tool_final", name: "final", arguments: "{}" }],
    usage: { totalTokens: 12 },
  });
});

test("getStreamingContentHandler preserves a terminal overlay for cancelled partial content", async () => {
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
            content: "",
            reasoning: undefined,
            status: "cancelled",
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
                content: "partial before cancel",
                reasoning: "cancelled reasoning",
                status: "cancelled",
                toolCalls: [{ id: "tool_cancel", name: "search", arguments: "{}" }],
                createdAt: 1,
                updatedAt: 1,
              },
            ];
          },
        }),
      }),
    },
  } as any;

  const result = await getStreamingContentHandler(ctx, { messageId: "msg_1" as any });

  assert.deepEqual(result, {
    content: "partial before cancel",
    reasoning: "cancelled reasoning",
    status: "cancelled",
    modelId: "openai/gpt-4.1",
    participantName: "Assistant",
    toolCalls: [{ id: "tool_cancel", name: "search", arguments: "{}" }],
    usage: undefined,
  });
});
