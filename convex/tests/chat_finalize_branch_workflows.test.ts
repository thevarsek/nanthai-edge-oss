import assert from "node:assert/strict";
import test from "node:test";

import {
  finalizeGenerationHandler,
  updateMessageContentHandler,
  updateMessageReasoningHandler,
  updateMessageToolCallsHandler,
} from "../chat/mutations_internal_handlers";

function buildFinalizeCtx(options?: {
  records?: Record<string, Record<string, unknown>>;
  tableRows?: Record<string, Array<Record<string, unknown>>>;
}) {
  const records = new Map(Object.entries(options?.records ?? {}));
  const tableRows = new Map(Object.entries(options?.tableRows ?? {}));
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown>; id: string }> = [];
  const deletes: string[] = [];
  const scheduled: Array<{ delay: number; args: Record<string, unknown> }> = [];

  const queryRows = (table: string, filters: Array<[string, unknown]>) =>
    (tableRows.get(table) ?? []).filter((row) =>
      filters.every(([field, value]) => row[field] === value),
    );

  const ctx = {
    db: {
      get: async (id: string) => records.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
        records.set(id, { ...(records.get(id) ?? { _id: id }), ...patch });
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = `${table}_${inserts.length + 1}`;
        inserts.push({ table, value, id });
        records.set(id, { _id: id, ...value });
        tableRows.set(table, [...(tableRows.get(table) ?? []), { _id: id, ...value }]);
        return id;
      },
      delete: async (id: string) => {
        deletes.push(id);
        records.delete(id);
      },
      query: (table: string) => {
        const filters: Array<[string, unknown]> = [];
        const chain = {
          withIndex: (_index: string, apply?: (q: any) => unknown) => {
            const q = {
              eq: (field: string, value: unknown) => {
                filters.push([field, value]);
                return q;
              },
              field: (name: string) => name,
            };
            apply?.(q);
            return chain;
          },
          filter: () => chain,
          order: () => chain,
          first: async () => queryRows(table, filters)[0] ?? null,
          collect: async () => queryRows(table, filters),
        };
        return chain;
      },
    },
    scheduler: {
      runAfter: async (delay: number, _fn: unknown, args: Record<string, unknown>) => {
        scheduled.push({ delay, args });
        return "scheduled_1";
      },
    },
    storage: { delete: async () => undefined },
  } as any;

  return { ctx, records, patches, inserts, deletes, scheduled };
}

test("finalizeGenerationHandler schedules completion push, auto-audio, and usage backfill without SSE usage", async () => {
  const state = buildFinalizeCtx({
    records: {
      job_1: { _id: "job_1", messageId: "message_1", status: "streaming" },
      message_1: {
        _id: "message_1",
        chatId: "chat_1",
        role: "assistant",
        status: "streaming",
        parentMessageIds: ["user_msg_1"],
      },
      user_msg_1: {
        _id: "user_msg_1",
        chatId: "chat_1",
        role: "user",
        audioStorageId: "input_audio",
      },
      chat_1: {
        _id: "chat_1",
        userId: "user_1",
        title: "Ops Review",
        autoAudioResponseOverride: "enabled",
      },
    },
    tableRows: {
      generationContinuations: [{ _id: "continuation_1", jobId: "job_1" }],
      streamingMessages: [],
      userPreferences: [{
        _id: "prefs_1",
        userId: "user_1",
        chatCompletionNotificationsEnabled: true,
        autoAudioResponse: true,
      }],
      messages: [],
    },
  });

  await finalizeGenerationHandler(state.ctx, {
    messageId: "message_1",
    jobId: "job_1",
    chatId: "chat_1",
    userId: "user_1",
    content: "Done",
    status: "completed",
    triggerUserMessageId: "user_msg_1",
    openrouterGenerationId: "gen_1",
  } as never);

  assert.deepEqual(state.deletes, ["continuation_1"]);
  assert.ok(state.patches.some((entry) => entry.id === "message_1" && entry.patch.status === "completed"));
  assert.ok(state.patches.some((entry) => entry.id === "chat_1" && entry.patch.lastMessagePreview === "Done"));
  assert.ok(state.patches.some((entry) => entry.id === "user_msg_1" && entry.patch.chatCompletionNotifiedAt));
  assert.ok(state.scheduled.some((entry) => entry.delay === 2000 && entry.args.openrouterGenerationId === "gen_1"));
  assert.ok(state.scheduled.some((entry) => entry.args.messageId === "message_1" && Object.keys(entry.args).length === 1));
  assert.ok(state.scheduled.some((entry) => entry.args.category === "CHAT_COMPLETION"));
  assert.equal(state.inserts.some((entry) => entry.table === "usageRecords"), false);
});

test("finalizeGenerationHandler records usage with unknown cost and schedules authoritative fetch", async () => {
  const state = buildFinalizeCtx({
    records: {
      job_2: { _id: "job_2", messageId: "message_2", status: "streaming" },
      message_2: {
        _id: "message_2",
        chatId: "chat_1",
        role: "assistant",
        status: "streaming",
        modelId: "provider/no-price",
      },
      chat_1: { _id: "chat_1", userId: "user_1", title: "Chat" },
    },
    tableRows: {
      generationContinuations: [],
      streamingMessages: [],
      cachedModels: [{ _id: "model_1", modelId: "provider/no-price" }],
      usageRecords: [],
    },
  });

  await finalizeGenerationHandler(state.ctx, {
    messageId: "message_2",
    jobId: "job_2",
    chatId: "chat_1",
    userId: "user_1",
    content: "Cost pending",
    status: "completed",
    openrouterGenerationId: "gen_2",
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      webSearchRequests: 1,
    },
  } as never);

  const usageRecord = state.inserts.find((entry) => entry.table === "usageRecords");
  assert.ok(usageRecord);
  assert.equal(usageRecord.value.cost, undefined);
  assert.equal(usageRecord.value.webSearchRequests, 1);
  assert.ok(state.scheduled.some((entry) => entry.delay === 2000 && entry.args.openrouterGenerationId === "gen_2"));
});

test("streaming update handlers no-op for missing and terminal messages", async () => {
  const state = buildFinalizeCtx({
    records: {
      done: { _id: "done", chatId: "chat_1", status: "completed" },
    },
    tableRows: { streamingMessages: [] },
  });

  await updateMessageContentHandler(state.ctx, {
    messageId: "missing",
    content: "ignored",
    status: "streaming",
  } as never);
  await updateMessageReasoningHandler(state.ctx, {
    messageId: "done",
    reasoning: "ignored",
  } as never);
  await updateMessageToolCallsHandler(state.ctx, {
    messageId: "missing",
    toolCalls: [{ id: "call_1", name: "search", arguments: "{}" }],
  } as never);

  assert.deepEqual(state.patches, []);
  assert.deepEqual(state.inserts, []);
});
