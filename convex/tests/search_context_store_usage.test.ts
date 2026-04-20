import assert from "node:assert/strict";
import test from "node:test";

import { retryMessageHandler } from "../chat/mutations_retry_handler";
import { resolveRegenerationSynthesisData } from "../search/actions_regenerate_paper";
import {
  upsertSearchContextForMessage,
} from "../search/mutations_internal";

test("upsertSearchContextForMessage stores payload outside messages and clears message.searchContext", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      query: (table: string) => {
        assert.equal(table, "searchContexts");
        return {
          withIndex: () => ({
            first: async () => null,
          }),
        };
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "search_context_1";
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  } as any;

  await upsertSearchContextForMessage(ctx, {
    messageId: "message_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    mode: "web",
    searchContext: { queries: ["q1"], searchResults: [] },
  });

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].table, "searchContexts");
  assert.equal(inserts[0].value.messageId, "message_1");
  assert.equal(inserts[0].value.chatId, "chat_1");
  assert.equal(inserts[0].value.userId, "user_1");
  assert.equal(inserts[0].value.mode, "web");
  assert.deepEqual(inserts[0].value.payload, {
    queries: ["q1"],
    searchResults: [],
  });

  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, "message_1");
  assert.deepEqual(patches[0].patch, { searchContext: undefined });
});

test("retryMessageHandler reuses cached web-search context from searchContexts table", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const scheduled: Array<{ fnPath: unknown; payload: Record<string, unknown> }> = [];

  const cachedPayload = {
    complexity: 2,
    queries: ["q1"],
    searchResults: [{ query: "q1", content: "result", citations: [], success: true }],
  };

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "assistant_old") {
          return {
            _id: "assistant_old",
            chatId: "chat_1",
            role: "assistant",
            modelId: "openai/gpt-5.2",
            participantId: undefined,
            participantName: undefined,
            participantEmoji: undefined,
            parentMessageIds: ["user_msg_1"],
          };
        }
        if (id === "chat_1") {
          return { _id: "chat_1", userId: "user_1" };
        }
        if (id === "user_msg_1") {
          return { _id: "user_msg_1", content: "Find latest model info" };
        }
        return null;
      },
      query: (table: string) => {
        if (table === "generationJobs") {
          return {
            withIndex: () => ({
              collect: async () => [],
            }),
          };
        }
        if (table === "searchContexts") {
          return {
            withIndex: () => ({
              first: async () => ({ payload: cachedPayload }),
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
        if (table === "userPreferences") {
          return {
            withIndex: () => ({
              first: async () => ({ userId: "user_1" }),
            }),
          };
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        if (table === "messages") return "assistant_new";
        if (table === "generationJobs") return "job_new";
        if (table === "searchSessions") return "session_new";
        return `${table}_id`;
      },
      patch: async () => {
        // Not relevant for this regression.
      },
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

  await retryMessageHandler(ctx, {
    messageId: "assistant_old" as any,
    apiKey: "sk-test",
    searchMode: "web",
    complexity: 2,
  });

  const searchSessionInsert = inserts.find((entry) => entry.table === "searchSessions");
  assert.ok(searchSessionInsert);
  assert.equal(searchSessionInsert.value.status, "synthesizing");
  assert.equal(searchSessionInsert.value.progress, 70);
  assert.equal(searchSessionInsert.value.currentPhase, "synthesizing");

  const searchRun = scheduled.find((entry) => entry.payload?.cachedSearchContext);
  assert.ok(searchRun);
  assert.deepEqual(searchRun.payload.cachedSearchContext, cachedPayload);
});

test("retryMessageHandler silently strips original message integrations on non-tool model", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "assistant_old") {
          return {
            _id: "assistant_old",
            chatId: "chat_1",
            role: "assistant",
            modelId: "openai/gpt-5.2",
            participantId: undefined,
            participantName: undefined,
            participantEmoji: undefined,
            parentMessageIds: ["user_msg_1"],
            enabledIntegrations: ["gmail"],
          };
        }
        if (id === "chat_1") {
          return { _id: "chat_1", userId: "user_1" };
        }
        if (id === "user_msg_1") {
          return { _id: "user_msg_1", content: "Find latest model info" };
        }
        return null;
      },
      query: (table: string) => {
        if (table === "generationJobs") {
          return {
            withIndex: () => ({
              collect: async () => [],
            }),
          };
        }
        if (table === "searchContexts") {
          return {
            withIndex: () => ({
              first: async () => null,
            }),
          };
        }
        if (table === "cachedModels") {
          return {
            withIndex: (_index: string, apply: (query: any) => any) => {
              let selectedModelId = "";
              apply({
                eq: (_field: string, modelId: string) => {
                  selectedModelId = modelId;
                  return {};
                },
              });
              return {
                first: async () =>
                  selectedModelId === "openai/gpt-5.2"
                    ? { supportsTools: false }
                    : null,
              };
            },
          };
        }
        if (table === "chatParticipants") {
          return {
            withIndex: () => ({
              collect: async () => [],
            }),
          };
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return `${table}_new`;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
    scheduler: {
      runAfter: async () => "job_sched",
    },
  } as any;

  // Should succeed — integrations silently stripped for non-tool model
  await retryMessageHandler(ctx, {
    messageId: "assistant_old" as any,
    apiKey: "sk-test",
  });

  // A new assistant message should have been created with empty integrations
  const assistantInsert = inserts.find(
    (i) => i.table === "messages" && i.value.role === "assistant",
  );
  assert.ok(assistantInsert, "assistant message should be inserted");
  assert.deepEqual(
    assistantInsert.value.enabledIntegrations,
    [],
    "integrations should be stripped for non-tool model",
  );
});

test("retryMessageHandler rejects retrying old tool-backed messages without saved integrations", async () => {
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "assistant_old") {
          return {
            _id: "assistant_old",
            chatId: "chat_1",
            role: "assistant",
            modelId: "openai/gpt-5.2",
            participantId: undefined,
            participantName: undefined,
            participantEmoji: undefined,
            parentMessageIds: ["user_msg_1"],
            toolCalls: [{ id: "call_1", name: "gmail_search", arguments: "{}" }],
          };
        }
        if (id === "chat_1") {
          return { _id: "chat_1", userId: "user_1" };
        }
        return null;
      },
      query: () => {
        throw new Error("retry should fail before querying");
      },
      insert: async () => {
        throw new Error("retry should fail before inserting");
      },
      patch: async () => {
        throw new Error("retry should fail before patching");
      },
    },
    scheduler: {
      runAfter: async () => "job_sched",
    },
  } as any;

  await assert.rejects(
    retryMessageHandler(ctx, {
      messageId: "assistant_old" as any,
      apiKey: "sk-test",
    }),
    /integration settings were not saved/i,
  );
});

test("retryMessageHandler allows old retries when only built-in tools were used", async () => {
  const scheduled: Array<{ fnPath: unknown; payload: Record<string, unknown> }> = [];

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "assistant_old") {
          return {
            _id: "assistant_old",
            chatId: "chat_1",
            role: "assistant",
            modelId: "openai/gpt-5.2",
            participantId: undefined,
            participantName: undefined,
            participantEmoji: undefined,
            parentMessageIds: ["user_msg_1"],
            toolCalls: [{ id: "call_1", name: "generate_docx", arguments: "{}" }],
            generatedFileIds: ["file_1"],
          };
        }
        if (id === "chat_1") {
          return { _id: "chat_1", userId: "user_1" };
        }
        if (id === "user_msg_1") {
          return { _id: "user_msg_1", content: "Draft a document" };
        }
        return null;
      },
      query: (table: string) => {
        if (table === "generationJobs") {
          return {
            withIndex: () => ({
              collect: async () => [],
            }),
          };
        }
        if (table === "searchContexts") {
          return {
            withIndex: () => ({
              first: async () => null,
            }),
          };
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
      insert: async (table: string) => {
        if (table === "messages") return "assistant_new";
        if (table === "streamingMessages") return "streaming_new";
        if (table === "generationJobs") return "job_new";
        throw new Error(`Unexpected insert table: ${table}`);
      },
      patch: async () => {
        // Not relevant for this regression.
      },
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

  await retryMessageHandler(ctx, {
    messageId: "assistant_old" as any,
    apiKey: "sk-test",
  });

  assert.ok(scheduled.length >= 1);
  assert.ok(scheduled.some((entry) => entry.payload?.assistantMessageIds || entry.payload?.sessionId));
});

test("resolveRegenerationSynthesisData reads cached context from searchContexts before message fallback", async () => {
  let callCount = 0;

  const ctx = {
    runQuery: async (_fn: unknown, _args: Record<string, unknown>) => {
      callCount += 1;
      if (callCount === 1) {
        return [];
      }
      if (callCount === 2) {
        return { assistantMessageId: "assistant_1" };
      }
      if (callCount === 3) {
        return { findings: "cached synthesis" };
      }
      throw new Error("Unexpected extra runQuery call");
    },
  } as any;

  const result = await resolveRegenerationSynthesisData(
    ctx,
    "session_1" as any,
  );

  assert.equal(result, JSON.stringify({ findings: "cached synthesis" }));
  assert.equal(callCount, 3);
});
