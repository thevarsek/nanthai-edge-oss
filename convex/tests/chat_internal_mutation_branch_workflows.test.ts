import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  isJobCancelledHandler,
  storeAncillaryCostHandler,
  storeGenerationUsageHandler,
  updateJobStatusHandler,
  updateMessageContentHandler,
  updateMessageReasoningHandler,
  updateMessageToolCallsHandler,
} from "../chat/mutations_internal_handlers";
import { patchMessageAudioHandler } from "../chat/audio_mutation_handlers";

function buildMutationCtx(options?: {
  records?: Record<string, Record<string, unknown>>;
  tableRows?: Record<string, Array<Record<string, unknown>>>;
  storageDeleteThrows?: boolean;
}) {
  const records = new Map(Object.entries(options?.records ?? {}));
  const tableRows = new Map(Object.entries(options?.tableRows ?? {}));
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown>; id: string }> = [];
  const deletes: string[] = [];
  const storageDeletes: string[] = [];
  const scheduled: Array<{ delay: number; payload: Record<string, unknown> }> = [];

  const queryBuilder = (table: string) => {
    const chain = {
      withIndex: (_index: string, apply?: (q: any) => unknown) => {
        const q = { eq: () => q, field: (name: string) => name };
        apply?.(q);
        return chain;
      },
      filter: (_apply?: (q: any) => unknown) => chain,
      order: () => chain,
      first: async () => (tableRows.get(table) ?? [])[0] ?? null,
      unique: async () => (tableRows.get(table) ?? [])[0] ?? null,
      collect: async () => tableRows.get(table) ?? [],
    };
    return chain;
  };

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
      query: queryBuilder,
    },
    storage: {
      delete: async (id: string) => {
        storageDeletes.push(id);
        if (options?.storageDeleteThrows) throw new Error("already gone");
      },
    },
    scheduler: {
      runAfter: async (delay: number, _fn: unknown, payload: Record<string, unknown>) => {
        scheduled.push({ delay, payload });
      },
    },
  } as never;

  return { ctx, records, tableRows, patches, inserts, deletes, storageDeletes, scheduled };
}

test("streaming message mutation handlers patch direct rows, upsert fallbacks, and skip terminal messages", async () => {
  const state = buildMutationCtx({
    records: {
      message_streaming: { _id: "message_streaming", chatId: "chat_1", status: "streaming" },
      message_done: { _id: "message_done", chatId: "chat_1", status: "completed" },
      streaming_1: { _id: "streaming_1", messageId: "message_streaming", chatId: "chat_1", status: "streaming" },
    },
    tableRows: { streamingMessages: [] },
  });

  await updateMessageContentHandler(state.ctx, {
    messageId: "missing",
    content: "ignored",
    status: "streaming",
  } as never);
  await updateMessageContentHandler(state.ctx, {
    messageId: "message_done",
    content: "ignored",
    status: "completed",
  } as never);
  await updateMessageContentHandler(state.ctx, {
    messageId: "message_streaming",
    streamingMessageId: "streaming_1",
    content: "direct content",
    status: "streaming",
  } as never);
  await updateMessageReasoningHandler(state.ctx, {
    messageId: "message_streaming",
    reasoning: "fallback reasoning",
  } as never);
  await updateMessageToolCallsHandler(state.ctx, {
    messageId: "message_streaming",
    toolCalls: [{ id: "call_1", name: "search", arguments: "{}" }],
  } as never);

  assert.equal(state.patches[0]?.id, "streaming_1");
  assert.equal(state.patches[0]?.patch.content, "direct content");
  assert.equal(state.inserts[0]?.table, "streamingMessages");
  assert.equal(state.inserts[0]?.value.reasoning, "fallback reasoning");
  const toolCallPatch = state.patches.at(-1)?.patch as { toolCalls?: Array<{ name: string }> } | undefined;
  assert.equal(toolCallPatch?.toolCalls?.[0]?.name, "search");
});

test("patchMessageAudio removes replaced blobs, tolerates storage races, and clears generation flags", async () => {
  const state = buildMutationCtx({
    records: {
      chat_1: { _id: "chat_1", userId: "user_1" },
      message_1: { _id: "message_1", chatId: "chat_1", audioStorageId: "old_audio" },
      message_2: { _id: "message_2", chatId: "chat_1", audioStorageId: "same_audio" },
      run_1: { _id: "run_1", userId: "user_1", chatId: "chat_1", activeAttemptId: "attempt_1", state: "running", domainType: "message_speech", sourceMessageId: "message_1" },
      run_2: { _id: "run_2", userId: "user_1", chatId: "chat_1", activeAttemptId: "attempt_2", state: "running", domainType: "message_speech", sourceMessageId: "message_2" },
      attempt_1: { _id: "attempt_1", runId: "run_1", fence: 1, status: "running" },
      attempt_2: { _id: "attempt_2", runId: "run_2", fence: 1, status: "running" },
    },
    storageDeleteThrows: true,
  });

  await patchMessageAudioHandler(state.ctx, {
    messageId: "message_1",
    audioStorageId: "new_audio",
    audioDurationMs: 1200,
    audioVoice: "alloy",
    audioTranscript: "hello",
    audioGeneratedAt: 42,
    executionRunId: "run_1",
    executionAttemptId: "attempt_1",
    executionFence: 1,
  } as never);
  await patchMessageAudioHandler(state.ctx, {
    messageId: "message_2",
    audioStorageId: "same_audio",
    executionRunId: "run_2",
    executionAttemptId: "attempt_2",
    executionFence: 1,
  } as never);

  assert.deepEqual(state.storageDeletes, ["old_audio"]);
  assert.equal(state.patches[0]?.patch.audioGenerating, undefined);
  assert.equal(state.patches[0]?.patch.audioTranscript, "hello");
  assert.equal(state.patches[1]?.patch.audioStorageId, "same_audio");
});

test("updateJobStatus validates ownership, guards terminal revivals, and mirrors metadata to messages", async () => {
  const mismatch = buildMutationCtx({
    records: {
      job_1: { _id: "job_1", messageId: "message_a", status: "queued" },
    },
  });
  await assert.rejects(
    updateJobStatusHandler(mismatch.ctx, {
      jobId: "job_1",
      messageId: "message_b",
      status: "streaming",
    } as never),
    (error: unknown) => error instanceof ConvexError,
  );

  const terminal = buildMutationCtx({
    records: {
      job_2: { _id: "job_2", messageId: "message_2", status: "cancelled" },
    },
  });
  await updateJobStatusHandler(terminal.ctx, {
    jobId: "job_2",
    messageId: "message_2",
    status: "streaming",
  } as never);
  assert.deepEqual(terminal.patches, []);

  const active = buildMutationCtx({
    records: {
      job_3: { _id: "job_3", messageId: "message_3", status: "streaming" },
      message_3: { _id: "message_3", status: "streaming" },
    },
  });
  await updateJobStatusHandler(active.ctx, {
    jobId: "job_3",
    messageId: "message_3",
    status: "failed",
    startedAt: 10,
    error: "upstream",
    openrouterGenerationId: "gen_123",
    terminalErrorCode: "upstream_error",
  } as never);

  assert.equal(active.patches[0]?.id, "job_3");
  assert.equal(active.patches[0]?.patch.completedAt !== undefined, true);
  assert.equal(active.patches[1]?.id, "message_3");
  assert.deepEqual(active.patches[1]?.patch, {
    openrouterGenerationId: "gen_123",
    terminalErrorCode: "upstream_error",
  });
});

test("job cancellation query handles missing, cancelled, and active jobs", async () => {
  const state = buildMutationCtx({
    records: {
      cancelled: { _id: "cancelled", status: "cancelled" },
      active: { _id: "active", status: "streaming" },
    },
  });

  assert.equal(await isJobCancelledHandler(state.ctx, { jobId: "missing" } as never), true);
  assert.equal(await isJobCancelledHandler(state.ctx, { jobId: "cancelled" } as never), true);
  assert.equal(await isJobCancelledHandler(state.ctx, { jobId: "active" } as never), false);
});

test("usage storage computes model-priced cost and patches existing primary usage rows", async () => {
  const existing = buildMutationCtx({
    records: {
      message_1: { _id: "message_1", modelId: "openai/gpt-test" },
    },
    tableRows: {
      cachedModels: [{ _id: "model_1", modelId: "openai/gpt-test", inputPricePer1M: 2, outputPricePer1M: 6 }],
      usageRecords: [{ _id: "usage_1", messageId: "message_1", source: undefined }],
    },
  });

  await storeGenerationUsageHandler(existing.ctx, {
    messageId: "message_1",
    chatId: "chat_1",
    userId: "user_1",
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
    isByok: true,
    cacheDiscount: -0.01,
  } as never);

  assert.equal((existing.patches[0]?.patch.usage as { cost?: number }).cost, 0.005);
  assert.equal(existing.patches[1]?.id, "usage_1");
  assert.equal(existing.inserts.length, 0);

  const inserted = buildMutationCtx({
    records: {
      message_2: { _id: "message_2" },
    },
    tableRows: { usageRecords: [] },
  });
  await storeGenerationUsageHandler(inserted.ctx, {
    messageId: "message_2",
    chatId: "chat_1",
    userId: "user_1",
    promptTokens: 1,
    completionTokens: 2,
    totalTokens: 3,
    cost: 0.1,
  } as never);
  await storeGenerationUsageHandler(inserted.ctx, {
    messageId: "missing",
    chatId: "chat_1",
    userId: "user_1",
    promptTokens: 1,
    completionTokens: 2,
    totalTokens: 3,
  } as never);

  assert.equal(inserted.inserts[0]?.table, "usageRecords");
  assert.equal(inserted.inserts[0]?.value.modelId, "unknown");
});

test("ancillary cost storage computes fallback model pricing without touching message usage", async () => {
  const state = buildMutationCtx({
    records: {
      message_1: { _id: "message_1", userId: "user_1", chatId: "chat_1" },
      chat_1: { _id: "chat_1", userId: "user_1" },
    },
    tableRows: {
      accountDeletionTombstones: [],
      cachedModels: [{ _id: "model_1", modelId: "openai/gpt-test", inputPricePer1M: 1, outputPricePer1M: 3 }],
    },
  });

  await storeAncillaryCostHandler(state.ctx, {
    messageId: "message_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    modelId: "openai/gpt-test",
    promptTokens: 1000,
    completionTokens: 1000,
    totalTokens: 2000,
    source: "title",
    generationId: "gen_title",
  });

  assert.equal(state.inserts[0]?.table, "usageRecords");
  assert.equal(state.inserts[0]?.value.cost, 0.004);
  assert.equal(state.inserts[0]?.value.source, "title");
  assert.deepEqual(state.patches, []);
});
