import assert from "node:assert/strict";
import test from "node:test";

import { sendMessageHandler } from "../chat/mutations_public_handlers";
import { regeneratePaperHandler } from "../search/mutations_regenerate";

test("sendMessageHandler rejects complexity-3 web search attachments before writing messages", async () => {
  const inserts: Array<[string, Record<string, unknown>]> = [];
  const patches: Array<[string, Record<string, unknown>]> = [];

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") {
          return {
            _id: "chat_1",
            userId: "user_1",
            title: "New conversation",
            messageCount: 0,
          };
        }
        return null;
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push([table, value]);
        return `${table}_id`;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push([id, patch]);
      },
        query: (table: string) => {
          if (table === "usageRecords") {
            return {
              withIndex: () => ({
                take: async () => [],
              }),
            };
          }
          if (table === "purchaseEntitlements") {
            return {
              withIndex: () => ({
                first: async () => ({ userId: "user_1", status: "active" }),
              }),
            };
          }
          return {
            withIndex: () => ({
              first: async () => null,
            }),
          };
        },
      },
      scheduler: {
        runAfter: async () => "job_sched",
      },
      storage: {
        getUrl: async () => "https://example.com/audio.m4a",
      },
    } as any;

  await assert.rejects(
    sendMessageHandler(ctx, {
      chatId: "chat_1",
      text: "Find me sources about MCP servers",
      attachments: [
        {
          type: "image",
          url: "https://example.com/example.png",
          sizeBytes: 512,
        },
      ],
      participants: [{ modelId: "openai/gpt-5.2" }],
      searchMode: "web",
      complexity: 3,
    } as any),
    /Complexity 3 search does not support attachments\./,
  );

  assert.equal(inserts.length, 0);
  assert.equal(patches.length, 0);
});

test("sendMessageHandler rejects mixed recorded and uploaded audio sources", async () => {
  const inserts: Array<[string, Record<string, unknown>]> = [];

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") {
          return {
            _id: "chat_1",
            userId: "user_1",
            title: "New conversation",
            messageCount: 0,
          };
        }
        return null;
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push([table, value]);
        return `${table}_id`;
      },
      patch: async () => undefined,
        query: (table: string) => {
          if (table === "usageRecords") {
            return {
              withIndex: () => ({
                take: async () => [],
              }),
            };
          }
          if (table === "purchaseEntitlements") {
            return {
              withIndex: () => ({
                first: async () => ({ userId: "user_1", status: "active" }),
              }),
            };
          }
          return {
            withIndex: () => ({
              order: () => ({
                first: async () => null,
                take: async () => [],
              }),
              first: async () => null,
            }),
          };
        },
    },
    scheduler: {
      runAfter: async () => "job_sched",
    },
    storage: {
      getUrl: async () => "https://example.com/audio.m4a",
    },
  } as any;

  await assert.rejects(
    sendMessageHandler(ctx, {
      chatId: "chat_1",
      text: "transcript text",
      attachments: [
        {
          type: "audio",
          storageId: "storage_audio",
          mimeType: "audio/mp4",
          sizeBytes: 2048,
        },
      ],
      recordedAudio: {
        storageId: "storage_recording",
        transcript: "recorded transcript",
        durationMs: 3_000,
      },
      participants: [{ modelId: "openai/gpt-5.2" }],
    } as any),
    /Choose one audio source before sending\./,
  );

  assert.equal(inserts.length, 0);
});

test("regeneratePaperHandler creates a fresh paper session and makes regenerated output active", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const scheduled: Array<{ fnPath: unknown; payload: Record<string, unknown> }> = [];

  const sourceSessionId = "session_source";
  const newAssistantMessageId = "message_regenerated";
  const newJobId = "job_regenerated";
  const newSessionId = "session_regenerated";

  const sourceSession = {
    _id: sourceSessionId,
    chatId: "chat_1",
    userId: "user_1",
    assistantMessageId: "message_original",
    query: "Research synthesis prompt",
    mode: "paper",
    complexity: 2,
    status: "completed",
  };
  const originalMessage = {
    _id: "message_original",
    chatId: "chat_1",
    parentMessageIds: ["user_message_1"],
  };
  const chat = {
    _id: "chat_1",
    userId: "user_1",
    messageCount: 5,
  };

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === sourceSessionId) return sourceSession;
        if (id === sourceSession.chatId) return chat;
        if (id === sourceSession.assistantMessageId) return originalMessage;
        return null;
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        if (table === "messages") return newAssistantMessageId;
        if (table === "generationJobs") return newJobId;
        if (table === "searchSessions") return newSessionId;
        return `${table}_id`;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
      query: () => ({
        withIndex: () => ({
          first: async () => ({ userId: "user_1", status: "active" }),
        }),
      }),
    },
    scheduler: {
      runAfter: async (
        _: number,
        fnPath: unknown,
        payload: Record<string, unknown>,
      ) => {
        scheduled.push({ fnPath, payload });
      },
    },
  } as any;

  const result = await regeneratePaperHandler(ctx, {
    sessionId: sourceSessionId as any,
    modelId: "openai/gpt-5.2",
    subagentsEnabled: true,
  });

  assert.equal(result.assistantMessageId, newAssistantMessageId);

  const searchSessionInsert = inserts.find((item) => item.table === "searchSessions");
  assert.ok(searchSessionInsert);
  assert.equal(searchSessionInsert.value.mode, "paper");
  assert.equal(searchSessionInsert.value.status, "writing");
  assert.equal(searchSessionInsert.value.progress, 90);
  assert.equal(searchSessionInsert.value.query, sourceSession.query);

  const assistantLinkPatch = patches.find((item) => item.id === newAssistantMessageId);
  assert.ok(assistantLinkPatch);
  assert.equal(assistantLinkPatch.patch.searchSessionId, newSessionId);

  const chatPatch = patches.find((item) => item.id === chat._id);
  assert.ok(chatPatch);
  assert.equal(chatPatch.patch.activeBranchLeafId, newAssistantMessageId);
  assert.equal(chatPatch.patch.messageCount, 6);

  const searchRun = scheduled.find((entry) => entry.payload?.sessionId === newSessionId);
  assert.ok(searchRun);
  assert.ok(searchRun.fnPath);
  assert.equal(searchRun.payload.sessionId, newSessionId);
  assert.equal(searchRun.payload.sourceSessionId, sourceSessionId);
  assert.equal(searchRun.payload.subagentsEnabled, false);
});
