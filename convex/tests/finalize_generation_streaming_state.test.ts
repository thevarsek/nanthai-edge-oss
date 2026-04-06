import assert from "node:assert/strict";
import test from "node:test";

import { finalizeGenerationHandler } from "../chat/mutations_internal_handlers.ts";

test("finalizeGenerationHandler copies content and reasoning from streamingMessages then deletes the row", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const deletes: string[] = [];

  const streamingRow = {
    _id: "stream_1",
    messageId: "msg_1",
    chatId: "chat_1",
    content: "Partial streamed content",
    reasoning: "Streamed reasoning",
    status: "streaming",
    updatedAt: 100,
  };

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "job_1") return { _id: id, status: "streaming" };
        if (id === "msg_1") return { _id: id, modelId: "openai/gpt-4.1", content: "", status: "pending" };
        if (id === "chat_1") return { _id: id };
        return null;
      },
      query: (table: string) => ({
        withIndex: (_index: string, builder: (q: { eq: (field: string, value: unknown) => { field: string; value: unknown } }) => { field: string; value: unknown }) => ({
          collect: async () => {
            const match = builder({ eq: (field: string, value: unknown) => ({ field, value }) });
            if (table === "streamingMessages" && match.field === "messageId" && match.value === "msg_1") {
              return [streamingRow];
            }
            return [];
          },
          first: async () => {
            const match = builder({ eq: (field: string, value: unknown) => ({ field, value }) });
            if (table === "streamingMessages" && match.field === "messageId" && match.value === "msg_1") {
              return streamingRow;
            }
            return null;
          },
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      delete: async (id: string) => {
        deletes.push(id);
      },
      insert: async () => "usage_1",
    },
    scheduler: {
      runAfter: async () => undefined,
    },
  } as any;

  await finalizeGenerationHandler(ctx, {
    messageId: "msg_1" as any,
    jobId: "job_1" as any,
    chatId: "chat_1" as any,
    content: "",
    status: "completed",
    userId: "user_1",
  });

  const messagePatch = patches.find((entry) => entry.id === "msg_1");
  assert.ok(messagePatch);
  assert.equal(messagePatch?.value.content, "Partial streamed content");
  assert.equal(messagePatch?.value.reasoning, "Streamed reasoning");
  assert.deepEqual(deletes, ["stream_1"]);
});

test("finalizeGenerationHandler preserves streamed partial content for cancellations", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];

  const streamingRow = {
    _id: "stream_2",
    messageId: "msg_cancelled",
    chatId: "chat_1",
    content: "Already streamed partial",
    status: "cancelled",
    updatedAt: 100,
  };

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "job_cancelled") return { _id: id, status: "cancelled" };
        if (id === "msg_cancelled") return { _id: id, modelId: "openai/gpt-4.1", content: "", status: "cancelled" };
        if (id === "chat_1") return { _id: id };
        return null;
      },
      query: (table: string) => ({
        withIndex: (
          _index: string,
          builder: (q: { eq: (field: string, value: unknown) => { field: string; value: unknown } }) => { field: string; value: unknown },
        ) => ({
          collect: async () => {
            const match = builder({ eq: (field: string, value: unknown) => ({ field, value }) });
            if (table === "streamingMessages" && match.field === "messageId" && match.value === "msg_cancelled") {
              return [streamingRow];
            }
            return [];
          },
          first: async () => {
            const match = builder({ eq: (field: string, value: unknown) => ({ field, value }) });
            if (table === "streamingMessages" && match.field === "messageId" && match.value === "msg_cancelled") {
              return streamingRow;
            }
            return null;
          },
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      delete: async () => undefined,
      insert: async () => "usage_1",
    },
    scheduler: {
      runAfter: async () => undefined,
    },
  } as any;

  await finalizeGenerationHandler(ctx, {
    messageId: "msg_cancelled" as any,
    jobId: "job_cancelled" as any,
    chatId: "chat_1" as any,
    content: "[Generation cancelled]",
    status: "cancelled",
    userId: "user_1",
  });

  const messagePatch = patches.find((entry) => entry.id === "msg_cancelled");
  assert.equal(messagePatch?.value.content, "Already streamed partial");
});

test("finalizeGenerationHandler uses streamed final content for chat preview updates", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];

  const streamingRow = {
    _id: "stream_preview",
    messageId: "msg_preview",
    chatId: "chat_preview",
    content: "Final streamed answer",
    status: "streaming",
    updatedAt: 100,
  };

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "job_preview") return { _id: id, status: "streaming" };
        if (id === "msg_preview") return { _id: id, modelId: "openai/gpt-4.1", content: "", status: "pending" };
        if (id === "chat_preview") return { _id: id };
        return null;
      },
      query: (table: string) => ({
        withIndex: (
          _index: string,
          builder: (q: { eq: (field: string, value: unknown) => { field: string; value: unknown } }) => { field: string; value: unknown },
        ) => ({
          collect: async () => {
            const match = builder({ eq: (field: string, value: unknown) => ({ field, value }) });
            if (table === "streamingMessages" && match.field === "messageId" && match.value === "msg_preview") {
              return [streamingRow];
            }
            return [];
          },
          first: async () => {
            const match = builder({ eq: (field: string, value: unknown) => ({ field, value }) });
            if (table === "streamingMessages" && match.field === "messageId" && match.value === "msg_preview") {
              return streamingRow;
            }
            return null;
          },
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      delete: async () => undefined,
      insert: async () => "usage_1",
    },
    scheduler: {
      runAfter: async () => undefined,
    },
  } as any;

  await finalizeGenerationHandler(ctx, {
    messageId: "msg_preview" as any,
    jobId: "job_preview" as any,
    chatId: "chat_preview" as any,
    content: "",
    status: "completed",
    userId: "user_1",
  });

  const chatPatch = patches.find((entry) => entry.id === "chat_preview");
  assert.equal(chatPatch?.value.lastMessagePreview, "Final streamed answer");
  assert.equal(typeof chatPatch?.value.lastMessageDate, "number");
});

test("finalizeGenerationHandler canonically cancels late completed jobs and clears overlays", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const deletes: string[] = [];
  const scheduledCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const streamingRow = {
    _id: "stream_late",
    messageId: "msg_late",
    chatId: "chat_late",
    content: "Partial before cancel",
    status: "cancelled",
    updatedAt: 100,
  };

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "job_late") {
          return {
            _id: id,
            status: "cancelled",
            sourceJobId: "scheduled_job_1",
            sourceExecutionId: "execution_1",
          };
        }
        if (id === "msg_late") return { _id: id, modelId: "openai/gpt-4.1", content: "", status: "cancelled" };
        if (id === "chat_late") return { _id: id };
        return null;
      },
      query: (table: string) => ({
        withIndex: (
          _index: string,
          builder: (q: { eq: (field: string, value: unknown) => { field: string; value: unknown } }) => { field: string; value: unknown },
        ) => ({
          collect: async () => {
            const match = builder({ eq: (field: string, value: unknown) => ({ field, value }) });
            if (table === "streamingMessages" && match.field === "messageId" && match.value === "msg_late") {
              return [streamingRow];
            }
            return [];
          },
          first: async () => {
            const match = builder({ eq: (field: string, value: unknown) => ({ field, value }) });
            if (table === "streamingMessages" && match.field === "messageId" && match.value === "msg_late") {
              return streamingRow;
            }
            return null;
          },
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      delete: async (id: string) => {
        deletes.push(id);
      },
      insert: async () => "usage_1",
    },
    scheduler: {
      runAfter: async (_delay: number, name: string, args: Record<string, unknown>) => {
        scheduledCalls.push({ name, args });
      },
    },
  } as any;

  await finalizeGenerationHandler(ctx, {
    messageId: "msg_late" as any,
    jobId: "job_late" as any,
    chatId: "chat_late" as any,
    content: "Late final content",
    status: "completed",
    userId: "user_1",
  });

  const messagePatch = patches.find((entry) => entry.id === "msg_late");
  assert.equal(messagePatch?.value.status, "cancelled");
  assert.equal(messagePatch?.value.content, "Partial before cancel");

  const jobPatch = patches.find((entry) => entry.id === "job_late");
  assert.equal(jobPatch?.value.status, "cancelled");
  assert.deepEqual(deletes, ["stream_late"]);
  assert.equal(scheduledCalls.length, 1);
  assert.equal(scheduledCalls[0]?.args.error, "Generation was cancelled by user.");
});
