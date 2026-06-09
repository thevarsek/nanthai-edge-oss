import assert from "node:assert/strict";
import test from "node:test";

import { retryMessageHandler } from "../chat/mutations_retry_handler";

function buildRetryCtx(options: {
  isPro?: boolean;
  assistant?: Record<string, unknown>;
  userMessage?: Record<string, unknown> | null;
  searchSession?: Record<string, unknown> | null;
  searchContext?: Record<string, unknown> | null;
  cachedModels?: Record<string, Record<string, unknown> | null>;
} = {}) {
  const inserts: Array<{ table: string; value: Record<string, unknown>; id: string }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const scheduled: Array<{ delay: number; fn: unknown; args: Record<string, unknown> }> = [];
  const cachedModels = options.cachedModels ?? {};

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "assistant_1") {
          return {
            _id: "assistant_1",
            chatId: "chat_1",
            userId: "user_1",
            role: "assistant",
            status: "completed",
            parentMessageIds: ["user_1_msg"],
            modelId: "openai/gpt-5.2",
            ...options.assistant,
          };
        }
        if (id === "chat_1") {
          return { _id: "chat_1", userId: "user_1", title: "Chat" };
        }
        if (id === "user_1_msg") {
          return options.userMessage === null
            ? null
            : { _id: "user_1_msg", chatId: "chat_1", role: "user", content: "Retry this", ...options.userMessage };
        }
        if (id === "search_session_1") {
          return options.searchSession ?? null;
        }
        return null;
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = table === "messages"
          ? `assistant_new_${inserts.filter((i) => i.table === table).length + 1}`
          : `${table}_${inserts.length + 1}`;
        inserts.push({ table, value, id });
        return id;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
      query: (table: string) => {
        if (table === "generationJobs") {
          return { withIndex: () => ({ collect: async () => [] }) };
        }
        if (table === "searchContexts") {
          return { withIndex: () => ({ first: async () => options.searchContext ?? null }) };
        }
        if (table === "purchaseEntitlements") {
          return {
            withIndex: () => ({
              first: async () => options.isPro ? { _id: "ent_1", userId: "user_1", status: "active" } : null,
            }),
          };
        }
        if (table === "userPreferences") {
          return { withIndex: () => ({ first: async () => ({ userId: "user_1" }) }) };
        }
        if (table === "oauthConnections") {
          return { withIndex: () => ({ first: async () => null }) };
        }
        if (table === "personas") {
          return { withIndex: () => ({ collect: async () => [] }) };
        }
        if (table === "cachedModels") {
          return {
            withIndex: (_index: string, apply: (q: any) => unknown) => {
              let selected = "";
              apply({
                eq: (_field: string, value: string) => {
                  selected = value;
                  return {};
                },
              });
              return { first: async () => cachedModels[selected] ?? null };
            },
          };
        }
        throw new Error(`Unexpected query table: ${table}`);
      },
    },
    scheduler: {
      runAfter: async (delay: number, fn: unknown, args: Record<string, unknown>) => {
        scheduled.push({ delay, fn, args });
        return "scheduled_1";
      },
    },
  } as any;

  return { ctx, inserts, patches, scheduled };
}

test("retryMessageHandler falls back from malformed stored contracts and skips memory priming for blank prompts", async () => {
  const state = buildRetryCtx({
    assistant: {
      retryContract: { participants: [], searchMode: "web" },
      searchSessionId: "search_session_1",
      modelId: undefined,
    },
    searchSession: { _id: "search_session_1", mode: "normal", complexity: 3 },
    userMessage: { content: "   " },
  });

  await retryMessageHandler(state.ctx, {
    messageId: "assistant_1" as any,
    expandMultiModelGroups: false,
  });

  const assistantInsert = state.inserts.find((entry) => entry.table === "messages");
  assert.ok(assistantInsert);
  assert.equal(typeof assistantInsert.value.modelId, "string");
  const generation = state.scheduled.find((entry) => Array.isArray(entry.args.assistantMessageIds));
  assert.ok(generation);
  assert.equal(generation.args.expandMultiModelGroups, false);
  assert.equal(generation.args.webSearchEnabled, false);
  assert.equal(state.scheduled.some((entry) => "queryText" in entry.args), false);
});

test("retryMessageHandler enforces Google Workspace compatible models on explicit stored-contract retries", async () => {
  const incompatible = buildRetryCtx({
    assistant: {
      retryContract: {
        participants: [{ modelId: "openai/gpt-4o" }],
        searchMode: "none",
        enabledIntegrations: ["drive"],
      },
    },
    cachedModels: {
      "other/model": { modelId: "other/model", supportsTools: true, hasZdrEndpoint: true, provider: "other" },
    },
  });

  await assert.rejects(
    () => retryMessageHandler(incompatible.ctx, {
      messageId: "assistant_1" as any,
      participants: [{ modelId: "other/model" }],
    }),
    (error: any) => {
      assert.equal(error?.data?.code, "RETRY_GOOGLE_COMPATIBLE_MODEL_REQUIRED");
      return true;
    },
  );

  const compatible = buildRetryCtx({
    assistant: {
      retryContract: {
        participants: [{ modelId: "openai/gpt-4o" }],
        searchMode: "none",
        enabledIntegrations: ["drive"],
      },
    },
    cachedModels: {
      "anthropic/claude-sonnet-4": {
        modelId: "anthropic/claude-sonnet-4",
        supportsTools: true,
        hasZdrEndpoint: true,
        provider: " Anthropic ",
      },
    },
  });

  await retryMessageHandler(compatible.ctx, {
    messageId: "assistant_1" as any,
    participants: [{ modelId: "anthropic/claude-sonnet-4" }],
  });

  const generation = compatible.scheduled.find((entry) => Array.isArray(entry.args.assistantMessageIds));
  assert.ok(generation);
  assert.deepEqual(generation.args.enabledIntegrations, ["drive"]);
});

test("retryMessageHandler routes fresh web retries through search sessions and clamps complexity", async () => {
  const high = buildRetryCtx({ isPro: true });
  await retryMessageHandler(high.ctx, {
    messageId: "assistant_1" as any,
    searchMode: "web",
    complexity: 99,
  });

  const highSession = high.inserts.find((entry) => entry.table === "searchSessions");
  assert.ok(highSession);
  assert.equal(highSession.value.complexity, 3);
  assert.equal(highSession.value.status, "planning");
  const highSearch = high.scheduled.find((entry) => entry.args.sessionId);
  assert.equal(highSearch?.args.complexity, 3);
  assert.equal(highSearch?.args.cachedSearchContext, undefined);

  const low = buildRetryCtx({ isPro: true });
  await retryMessageHandler(low.ctx, {
    messageId: "assistant_1" as any,
    searchMode: "web",
    complexity: -4,
  });

  const lowSession = low.inserts.find((entry) => entry.table === "searchSessions");
  assert.ok(lowSession);
  assert.equal(lowSession.value.complexity, 1);
  assert.equal(lowSession.value.status, "searching");
  assert.equal(lowSession.value.currentPhase, "searching");
});

test("retryMessageHandler downgrades retry subagents for non-Pro users without blocking normal generation", async () => {
  const state = buildRetryCtx({
    assistant: {
      retryContract: {
        participants: [{ modelId: "openai/gpt-5.2" }],
        searchMode: "none",
        subagentsEnabled: true,
      },
    },
  });

  await retryMessageHandler(state.ctx, { messageId: "assistant_1" as any });

  const assistantInsert = state.inserts.find((entry) => entry.table === "messages");
  assert.ok(assistantInsert);
  assert.equal((assistantInsert.value.retryContract as any).subagentsEnabled, false);
  const generation = state.scheduled.find((entry) => Array.isArray(entry.args.assistantMessageIds));
  assert.ok(generation);
  assert.equal(generation.args.subagentsEnabled, false);
});
