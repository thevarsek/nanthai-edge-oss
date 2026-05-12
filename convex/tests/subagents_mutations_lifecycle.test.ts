import assert from "node:assert/strict";
import test from "node:test";

import {
  attachGeneratedChartsToMessage,
  attachGeneratedFilesToMessage,
  checkpointRunContinuation,
  claimBatchForResume,
  claimRunForExecution,
  createBatch,
  finalizeRun,
  updateBatchStatus,
  updateRunStreaming,
} from "../subagents/mutations";

type RecordValue = Record<string, any>;

function createMemoryDb(seed: Record<string, RecordValue> = {}) {
  const records = new Map<string, RecordValue>(
    Object.entries(seed).map(([id, value]) => [id, { _id: id, ...value }]),
  );
  const inserts: Array<{ table: string; id: string; value: RecordValue }> = [];
  const patches: Array<{ id: string; value: RecordValue }> = [];
  const counters = new Map<string, number>();

  const rowsForTable = (table: string) =>
    [...records.values()].filter((row) => row._table === table);

  return {
    records,
    inserts,
    patches,
    db: {
      get: async (id: string) => records.get(id) ?? null,
      insert: async (table: string, value: RecordValue) => {
        const next = (counters.get(table) ?? 0) + 1;
        counters.set(table, next);
        const id = `${table}_${next}`;
        const row = { _id: id, _table: table, ...value };
        records.set(id, row);
        inserts.push({ table, id, value });
        return id;
      },
      patch: async (id: string, value: RecordValue) => {
        const existing = records.get(id) ?? { _id: id };
        records.set(id, { ...existing, ...value });
        patches.push({ id, value });
      },
      query: (table: string) => ({
        withIndex: (_name: string, cb?: (q: any) => unknown) => {
          const conditions: Array<[string, unknown]> = [];
          cb?.({
            eq: (field: string, value: unknown) => {
              conditions.push([field, value]);
              return {
                eq: (nextField: string, nextValue: unknown) => {
                  conditions.push([nextField, nextValue]);
                  return {};
                },
              };
            },
          });
          return {
          collect: async () => {
            return rowsForTable(table).filter((row) =>
              conditions.every(([field, value]) => row[field] === value));
          },
        };
        },
      }),
    },
  };
}

test("subagent createBatch persists child runs and links the parent message", async () => {
  const state = createMemoryDb({
    parent_msg_1: { _table: "messages", status: "streaming" },
  });

  const result = await (createBatch as any)._handler({ db: state.db }, {
    parentMessageId: "parent_msg_1",
    sourceUserMessageId: "user_msg_1",
    parentJobId: "job_1",
    chatId: "chat_1",
    userId: "user_1",
    toolCallId: "tool_call_1",
    toolCallArguments: "{\"tasks\":[]}",
    toolRoundCalls: [{ id: "tool_call_1" }],
    toolRoundResults: [],
    childConversationSeed: [{ role: "user", content: "Research this" }],
    resumeConversationSeed: [{ role: "assistant", content: "Working" }],
    paramsSnapshot: { requestParams: { webSearchEnabled: true } },
    participantSnapshot: { participant: { modelId: "openai/gpt-5" } },
    tasks: [
      { title: "Research", prompt: "Find sources" },
      { title: "Synthesize", prompt: "Write summary" },
    ],
  });

  assert.equal(result.batchId, "subagentBatches_1");
  assert.deepEqual(result.runIds, ["subagentRuns_1", "subagentRuns_2"]);
  assert.equal(state.records.get("subagentBatches_1")?.childCount, 2);
  assert.equal(state.records.get("subagentRuns_1")?.childIndex, 0);
  assert.equal(state.records.get("subagentRuns_2")?.taskPrompt, "Write summary");
  assert.deepEqual(state.patches.at(-1), {
    id: "parent_msg_1",
    value: { subagentBatchId: "subagentBatches_1" },
  });
});

test("subagent run lifecycle mutations guard stale states and update observable counters", async () => {
  const state = createMemoryDb({
    batch_1: { _table: "subagentBatches", status: "running_children" },
    batch_2: { _table: "subagentBatches", status: "waiting_to_resume" },
    run_streaming: {
      _table: "subagentRuns",
      batchId: "batch_1",
      status: "queued",
      continuationCount: 0,
    },
    run_terminal: {
      _table: "subagentRuns",
      batchId: "batch_1",
      status: "completed",
      content: "done",
    },
    run_claim: {
      _table: "subagentRuns",
      batchId: "batch_1",
      status: "queued",
      startedAt: 123,
    },
    run_checkpoint: {
      _table: "subagentRuns",
      batchId: "batch_1",
      status: "streaming",
      content: "partial",
      toolCalls: [{ id: "call_1", name: "search", arguments: "{}" }],
    },
    run_finalize: {
      _table: "subagentRuns",
      batchId: "batch_2",
      status: "streaming",
      content: "old",
    },
    run_sibling: {
      _table: "subagentRuns",
      batchId: "batch_2",
      status: "completed",
    },
  });

  await (updateRunStreaming as any)._handler({ db: state.db }, {
    runId: "missing_run",
    status: "streaming",
  });
  await (updateRunStreaming as any)._handler({ db: state.db }, {
    runId: "run_terminal",
    content: "ignored",
  });
  await (updateRunStreaming as any)._handler({ db: state.db }, {
    runId: "run_streaming",
    content: "hello",
    reasoning: "because",
    usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
    toolResults: [{ toolCallId: "call_1", toolName: "search", result: "ok" }],
    generatedFiles: [{
      storageId: "storage_1",
      filename: "answer.md",
      mimeType: "text/markdown",
      toolName: "create_file",
    }],
    generatedCharts: [{
      toolName: "chart",
      chartType: "bar",
      title: "Trend",
      elements: [{ x: "May", y: 1 }],
    }],
    status: "streaming",
  });

  assert.equal(state.records.get("run_terminal")?.content, "done");
  assert.equal(state.records.get("run_streaming")?.content, "hello");
  assert.equal(typeof state.records.get("run_streaming")?.startedAt, "number");

  assert.equal(await (claimRunForExecution as any)._handler({ db: state.db }, {
    runId: "missing_run",
    expectedStatuses: ["queued"],
  }), false);
  assert.equal(await (claimRunForExecution as any)._handler({ db: state.db }, {
    runId: "run_terminal",
    expectedStatuses: ["completed"],
  }), false);
  assert.equal(await (claimRunForExecution as any)._handler({ db: state.db }, {
    runId: "run_claim",
    expectedStatuses: ["waiting_continuation"],
  }), false);
  assert.equal(await (claimRunForExecution as any)._handler({ db: state.db }, {
    runId: "run_claim",
    expectedStatuses: ["queued"],
  }), true);
  assert.equal(state.records.get("run_claim")?.status, "streaming");
  assert.equal(state.records.get("run_claim")?.startedAt, 123);

  assert.equal(await (checkpointRunContinuation as any)._handler({ db: state.db }, {
    runId: "run_terminal",
    conversationSnapshot: [],
    continuationCount: 1,
  }), null);
  const checkpoint = await (checkpointRunContinuation as any)._handler({ db: state.db }, {
    runId: "run_checkpoint",
    reasoning: "still thinking",
    conversationSnapshot: [{ role: "assistant", content: "partial" }],
    continuationCount: 2,
  });
  assert.deepEqual(checkpoint, { batchId: "batch_1" });
  assert.equal(state.records.get("run_checkpoint")?.status, "waiting_continuation");
  assert.equal(state.records.get("run_checkpoint")?.content, "partial");
  assert.equal(state.records.get("run_checkpoint")?.reasoning, "still thinking");

  assert.equal(await (finalizeRun as any)._handler({ db: state.db }, {
    runId: "missing_run",
    status: "failed",
  }), null);
  const finalized = await (finalizeRun as any)._handler({ db: state.db }, {
    runId: "run_finalize",
    status: "failed",
    error: "model failed",
  });
  assert.deepEqual(finalized, { batchId: "batch_2", allTerminal: true });
  assert.equal(state.records.get("run_finalize")?.error, "model failed");
  assert.equal(state.records.get("batch_2")?.completedChildCount, 2);
  assert.equal(state.records.get("batch_2")?.failedChildCount, 1);
});

test("subagent batch and generated artifact mutations are idempotent", async () => {
  const state = createMemoryDb({
    batch_1: { _table: "subagentBatches", status: "running_children" },
    batch_2: { _table: "subagentBatches", status: "waiting_to_resume" },
    message_1: {
      _table: "messages",
      generatedFileIds: ["file_existing"],
      generatedChartIds: ["chart_existing"],
    },
    file_existing: {
      _table: "generatedFiles",
      messageId: "message_1",
      storageId: "storage_existing",
    },
    chart_existing: {
      _table: "generatedCharts",
      messageId: "message_1",
      chartType: "bar",
      title: "Existing",
      elements: [{ x: "A", y: 1 }],
    },
  });

  assert.equal(await (updateBatchStatus as any)._handler({ db: state.db }, {
    batchId: "missing_batch",
    status: "completed",
  }), false);
  assert.equal(await (updateBatchStatus as any)._handler({ db: state.db }, {
    batchId: "batch_1",
    status: "waiting_to_resume",
    expectedCurrentStatus: "resuming",
  }), false);
  assert.equal(await (updateBatchStatus as any)._handler({ db: state.db }, {
    batchId: "batch_1",
    status: "waiting_to_resume",
    expectedCurrentStatus: "running_children",
    continuationScheduledAt: 42,
  }), true);
  assert.equal(state.records.get("batch_1")?.status, "waiting_to_resume");
  assert.equal(state.records.get("batch_1")?.continuationScheduledAt, 42);

  assert.equal(await (claimBatchForResume as any)._handler({ db: state.db }, {
    batchId: "batch_1",
  }), true);
  assert.equal(await (claimBatchForResume as any)._handler({ db: state.db }, {
    batchId: "batch_1",
  }), false);
  assert.equal(state.records.get("batch_1")?.status, "resuming");

  assert.deepEqual(await (attachGeneratedFilesToMessage as any)._handler({ db: state.db }, {
    messageId: "missing_message",
    chatId: "chat_1",
    userId: "user_1",
    generatedFiles: [{
      storageId: "storage_ignored",
      filename: "ignored.md",
      mimeType: "text/markdown",
      toolName: "create_file",
    }],
  }), []);
  assert.deepEqual(await (attachGeneratedFilesToMessage as any)._handler({ db: state.db }, {
    messageId: "message_1",
    chatId: "chat_1",
    userId: "user_1",
    generatedFiles: [],
  }), []);
  const insertedFiles = await (attachGeneratedFilesToMessage as any)._handler({ db: state.db }, {
    messageId: "message_1",
    chatId: "chat_1",
    userId: "user_1",
    generatedFiles: [
      {
        storageId: "storage_existing",
        filename: "existing.md",
        mimeType: "text/markdown",
        toolName: "create_file",
      },
      {
        storageId: "storage_new",
        filename: "new.md",
        mimeType: "text/markdown",
        sizeBytes: 11,
        toolName: "create_file",
      },
    ],
  });
  assert.deepEqual(insertedFiles, ["generatedFiles_1"]);
  assert.deepEqual(state.records.get("message_1")?.generatedFileIds, ["file_existing", "generatedFiles_1"]);

  assert.deepEqual(await (attachGeneratedChartsToMessage as any)._handler({ db: state.db }, {
    messageId: "message_1",
    chatId: "chat_1",
    userId: "user_1",
    generatedCharts: [],
  }), []);
  const insertedCharts = await (attachGeneratedChartsToMessage as any)._handler({ db: state.db }, {
    messageId: "message_1",
    chatId: "chat_1",
    userId: "user_1",
    generatedCharts: [
      {
        toolName: "chart",
        chartType: "bar",
        title: "Existing",
        elements: [{ x: "A", y: 1 }],
      },
      {
        toolName: "chart",
        chartType: "line",
        title: "New",
        xLabel: "day",
        yLabel: "count",
        elements: [{ x: "B", y: 2 }],
      },
    ],
  });
  assert.deepEqual(insertedCharts, ["generatedCharts_1"]);
  assert.deepEqual(state.records.get("message_1")?.generatedChartIds, ["chart_existing", "generatedCharts_1"]);
});
