import assert from "node:assert/strict";
import test from "node:test";

import { finalizeGenerationHandler } from "../chat/mutations_internal_handlers";

function buildCtx(options?: {
  records?: Record<string, Record<string, unknown>>;
  tableRows?: Record<string, Array<Record<string, unknown>>>;
}) {
  const records = new Map(Object.entries(options?.records ?? {}));
  const tableRows = new Map(Object.entries(options?.tableRows ?? {}));
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown>; id: string }> = [];
  const deletes: string[] = [];
  const scheduled: Array<{ delay: number; args: Record<string, unknown> }> = [];
  const workflowSignals: Array<Record<string, unknown>> = [];

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
        return `scheduled_${scheduled.length}`;
      },
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      workflowSignals.push(args);
      return "scheduled-step-event";
    },
    storage: { delete: async () => undefined },
  } as any;

  return { ctx, records, patches, inserts, deletes, scheduled, workflowSignals };
}

test("finalizeGenerationHandler preserves partial content and artifacts for late cancelled scheduled generations", async () => {
  const state = buildCtx({
    records: {
      job_1: {
        _id: "job_1",
        messageId: "message_1",
        status: "cancelled",
        streamingMessageId: "streaming_1",
        sourceJobId: "scheduled_job_1",
        sourceExecutionId: "execution_1",
        sourceStepIndex: 2,
      },
      streaming_1: { _id: "streaming_1", messageId: "message_1" },
      message_1: {
        _id: "message_1",
        chatId: "chat_1",
        role: "assistant",
        status: "streaming",
        content: "Partial answer before cancellation",
      },
      chat_1: { _id: "chat_1", userId: "user_1", sourceJobId: "scheduled_job_1" },
      scheduled_job_1: {
        _id: "scheduled_job_1",
        activeWorkflowId: "workflow_1",
        activeExecutionId: "execution_1",
        activeStepIndex: 2,
      },
    },
    tableRows: {
      generationContinuations: [{ _id: "continuation_1", jobId: "job_1" }],
      streamingMessages: [],
      jobRuns: [{ _id: "run_1", chatId: "chat_1", startedAt: Date.now() - 500 }],
    },
  });

  await finalizeGenerationHandler(state.ctx, {
    messageId: "message_1",
    jobId: "job_1",
    chatId: "chat_1",
    userId: "user_1",
    content: "",
    status: "completed",
    audioStorageId: "audio_storage_1",
    audioDurationMs: 1234,
    audioGeneratedAt: 4567,
    audioMimeType: "audio/wav",
    audioSizeBytes: 48_044,
    audioTranscript: "Spoken answer",
    citations: [{ url: "https://example.com", title: "Example" }],
    documentCitations: [{ documentId: "doc_1", quote: "quoted text" }],
    generatedCharts: [{
      toolName: "data_python_exec",
      chartType: "bar",
      title: "Revenue",
      elements: [{ kind: "bar", x: "Q1", y: 10 }],
      pngBase64: "iVBORw0KGgo=",
    }],
  } as never);

  const messagePatch = state.patches.find((entry) => entry.id === "message_1")?.patch;
  assert.equal(messagePatch?.status, "cancelled");
  assert.equal(messagePatch?.content, "Partial answer before cancellation");
  assert.equal(messagePatch?.audioStorageId, "audio_storage_1");
  assert.equal(messagePatch?.audioMimeType, "audio/wav");
  assert.equal(messagePatch?.audioTranscript, "Spoken answer");
  assert.deepEqual(messagePatch?.generatedChartIds, ["generatedCharts_1"]);
  assert.deepEqual(messagePatch?.generatedFileIds, ["generatedFiles_2"]);
  assert.deepEqual(state.deletes, ["continuation_1", "streaming_1"]);
  assert.equal(state.inserts.some((entry) => entry.table === "generatedCharts"), true);
  assert.equal(state.inserts.some((entry) =>
    entry.table === "generatedFiles"
      && entry.value.toolName === "model_audio_generation"
      && entry.value.filename === "model-audio.wav"
      && entry.value.mimeType === "audio/wav"
      && entry.value.sizeBytes === 48_044
  ), true);
  assert.equal(state.scheduled.filter((entry) => entry.args.executionId === "execution_1").length, 0);
  assert.equal(state.workflowSignals.length, 1);
  assert.equal(state.workflowSignals[0]?.name, "scheduled-step-2-terminal");
});

test("finalizeGenerationHandler continues scheduled executions and stores usage for successful scheduled steps", async () => {
  const state = buildCtx({
    records: {
      job_2: {
        _id: "job_2",
        messageId: "message_2",
        status: "streaming",
        sourceJobId: "scheduled_job_2",
        sourceExecutionId: "execution_2",
      },
      message_2: {
        _id: "message_2",
        chatId: "chat_2",
        role: "assistant",
        status: "streaming",
        modelId: "openai/gpt-test",
      },
      chat_2: { _id: "chat_2", userId: "user_1", sourceJobId: "scheduled_job_2" },
      scheduled_job_2: {
        _id: "scheduled_job_2",
        activeWorkflowId: "workflow_2",
        activeExecutionId: "execution_2",
        activeStepIndex: 0,
      },
    },
    tableRows: {
      generationContinuations: [],
      streamingMessages: [],
      jobRuns: [{ _id: "run_2", chatId: "chat_2", startedAt: Date.now() - 1000 }],
      usageRecords: [],
    },
  });

  await finalizeGenerationHandler(state.ctx, {
    messageId: "message_2",
    jobId: "job_2",
    chatId: "chat_2",
    userId: "user_1",
    content: "Scheduled result",
    status: "completed",
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cost: 0.02,
      isByok: false,
    },
  } as never);

  const usageRecord = state.inserts.find((entry) => entry.table === "usageRecords");
  assert.equal(state.workflowSignals.length, 1);
  assert.equal(state.workflowSignals[0]?.name, "scheduled-step-0-terminal");
  assert.equal(usageRecord?.value.cost, 0.02);
  assert.equal(usageRecord?.value.modelId, "openai/gpt-test");
  assert.equal(state.scheduled.some((entry) => entry.delay === 2000), false);
});
