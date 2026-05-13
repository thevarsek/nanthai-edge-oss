import assert from "node:assert/strict";
import test from "node:test";

import {
  attachGeneratedChartsToMessage,
  attachGeneratedFilesToMessage,
  checkpointRunContinuation,
  finalizeRun,
  updateRunStreaming,
} from "../subagents/mutations";

type Row = Record<string, any>;

function memoryDb(seed: Record<string, Row>) {
  const records = new Map<string, Row>(
    Object.entries(seed).map(([id, row]) => [id, { _id: id, ...row }]),
  );
  const patches: Array<{ id: string; value: Row }> = [];
  const inserts: Array<{ table: string; id: string; value: Row }> = [];
  const counters = new Map<string, number>();

  return {
    records,
    patches,
    inserts,
    db: {
      get: async (id: string) => records.get(id) ?? null,
      patch: async (id: string, value: Row) => {
        records.set(id, { ...(records.get(id) ?? { _id: id }), ...value });
        patches.push({ id, value });
      },
      insert: async (table: string, value: Row) => {
        const next = (counters.get(table) ?? 0) + 1;
        counters.set(table, next);
        const id = `${table}_${next}`;
        records.set(id, { _id: id, _table: table, ...value });
        inserts.push({ table, id, value });
        return id;
      },
      query: (table: string) => ({
        withIndex: (_index: string, apply?: (q: any) => unknown) => {
          const filters: Array<[string, unknown]> = [];
          apply?.({
            eq: (field: string, value: unknown) => {
              filters.push([field, value]);
              return {};
            },
          });
          return {
            collect: async () =>
              [...records.values()].filter((row) =>
                row._table === table &&
                filters.every(([field, value]) => row[field] === value)),
          };
        },
      }),
    },
  };
}

test("subagent streaming updates can patch only tool-call deltas", async () => {
  const state = memoryDb({
    run_1: { _table: "subagentRuns", status: "streaming", batchId: "batch_1" },
  });

  await (updateRunStreaming as any)._handler({ db: state.db }, {
    runId: "run_1",
    toolCalls: [{ id: "call_1", name: "read_file", arguments: "{}" }],
  });

  assert.deepEqual(state.records.get("run_1")?.toolCalls, [
    { id: "call_1", name: "read_file", arguments: "{}" },
  ]);
  assert.equal(state.records.get("run_1")?.content, undefined);
  assert.equal(state.records.get("run_1")?.status, "streaming");
});

test("subagent checkpoints preserve explicit content, usage, and tool state", async () => {
  const state = memoryDb({
    run_1: {
      _table: "subagentRuns",
      status: "streaming",
      batchId: "batch_1",
      reasoning: "old reasoning",
    },
  });

  const result = await (checkpointRunContinuation as any)._handler({ db: state.db }, {
    runId: "run_1",
    content: "partial answer",
    usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
    toolCalls: [{ id: "call_1", name: "search", arguments: "{}" }],
    toolResults: [{ toolCallId: "call_1", toolName: "search", result: "ok" }],
    conversationSnapshot: [{ role: "assistant", content: "partial answer" }],
    continuationCount: 3,
  });

  assert.deepEqual(result, { batchId: "batch_1" });
  assert.equal(state.records.get("run_1")?.content, "partial answer");
  assert.equal(state.records.get("run_1")?.reasoning, "old reasoning");
  assert.equal(state.records.get("run_1")?.continuationCount, 3);
  assert.equal(typeof state.records.get("run_1")?.startedAt, "number");
});

test("finalizing subagent runs preserves explicit artifacts and non-failed counters", async () => {
  const state = memoryDb({
    batch_1: { _table: "subagentBatches", status: "running_children" },
    run_1: { _table: "subagentRuns", batchId: "batch_1", status: "streaming" },
    run_2: { _table: "subagentRuns", batchId: "batch_1", status: "queued" },
  });

  const result = await (finalizeRun as any)._handler({ db: state.db }, {
    runId: "run_1",
    status: "completed",
    content: "done",
    reasoning: "reasoned",
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    generatedFiles: [{
      storageId: "storage_1",
      filename: "summary.md",
      mimeType: "text/markdown",
      toolName: "generate_text_file",
    }],
    generatedCharts: [{
      toolName: "chart",
      chartType: "line",
      elements: [{ x: "Mon", y: 1 }],
    }],
  });

  assert.deepEqual(result, { batchId: "batch_1", allTerminal: false });
  assert.equal(state.records.get("batch_1")?.completedChildCount, 1);
  assert.equal(state.records.get("batch_1")?.failedChildCount, 0);
  assert.equal(state.records.get("run_1")?.content, "done");
});

test("generated file and chart attachment reuse existing rows missing from message ids", async () => {
  const state = memoryDb({
    message_1: { _table: "messages", generatedFileIds: [], generatedChartIds: [] },
    file_1: {
      _table: "generatedFiles",
      messageId: "message_1",
      storageId: "storage_existing",
    },
    chart_1: {
      _table: "generatedCharts",
      messageId: "message_1",
      chartType: "line",
      title: "",
      elements: [{ x: "Mon", y: 1 }],
    },
  });

  const files = await (attachGeneratedFilesToMessage as any)._handler({ db: state.db }, {
    messageId: "message_1",
    chatId: "chat_1",
    userId: "user_1",
    generatedFiles: [{
      storageId: "storage_existing",
      filename: "existing.md",
      mimeType: "text/markdown",
      toolName: "generate_text_file",
    }],
  });
  const charts = await (attachGeneratedChartsToMessage as any)._handler({ db: state.db }, {
    messageId: "message_1",
    chatId: "chat_1",
    userId: "user_1",
    generatedCharts: [{
      toolName: "chart",
      chartType: "line",
      elements: [{ x: "Mon", y: 1 }],
    }],
  });

  assert.deepEqual(files, []);
  assert.deepEqual(charts, []);
  assert.deepEqual(state.records.get("message_1")?.generatedFileIds, ["file_1"]);
  assert.deepEqual(state.records.get("message_1")?.generatedChartIds, ["chart_1"]);
});

test("chart attachment ignores non-empty inputs when the target message disappeared", async () => {
  const result = await (attachGeneratedChartsToMessage as any)._handler({
    db: memoryDb({}).db,
  }, {
    messageId: "missing",
    chatId: "chat_1",
    userId: "user_1",
    generatedCharts: [{
      toolName: "chart",
      chartType: "bar",
      elements: [{ x: "A", y: 1 }],
    }],
  });

  assert.deepEqual(result, []);
});
