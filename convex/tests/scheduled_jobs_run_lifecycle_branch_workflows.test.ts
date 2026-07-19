import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanOldJobRuns,
  createScheduledExecutionTurn,
  recordRunFailure,
  recordRunSuccess,
} from "../scheduledJobs/mutations";

function buildCtx(options?: {
  records?: Record<string, Record<string, unknown>>;
  tableRows?: Record<string, Array<Record<string, unknown>>>;
  cancelThrows?: boolean;
}) {
  const records = new Map(Object.entries(options?.records ?? {}));
  const tableRows = new Map(Object.entries(options?.tableRows ?? {}));
  const inserts: Array<{ table: string; value: Record<string, unknown>; id: string }> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const cancelled: string[] = [];

  const chainFor = (table: string) => ({
    withIndex: (_index: string, apply?: (q: any) => unknown) => {
      const q = { eq: () => q, field: (name: string) => name };
      apply?.(q);
      return chainFor(table);
    },
    collect: async () => tableRows.get(table) ?? [],
    unique: async () => (tableRows.get(table) ?? [])[0] ?? null,
    first: async () => (tableRows.get(table) ?? [])[0] ?? null,
  });

  const ctx = {
    db: {
      get: async (id: string) => records.get(id) ?? null,
      query: (table: string) => chainFor(table),
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = `${table}_${inserts.length + 1}`;
        const row = { _id: id, ...value };
        inserts.push({ table, value, id });
        records.set(id, row);
        tableRows.set(table, [...(tableRows.get(table) ?? []), row]);
        return id;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
        records.set(id, { ...(records.get(id) ?? { _id: id }), ...value });
      },
    },
    scheduler: {
      cancel: async (id: string) => {
        cancelled.push(id);
        if (options?.cancelThrows) throw new Error("already settled");
      },
    },
  } as never;

  return { ctx, inserts, patches, cancelled };
}

test("scheduled execution steps link to prior assistant messages and reuse matching participants", async () => {
  const harness = buildCtx({
    records: {
      job_1: {
        _id: "job_1",
        activeExecutionId: "exec_1",
        activeExecutionChatId: "chat_1",
        activeStepIndex: 0,
        activeAssistantMessageId: "assistant_previous",
      },
    },
    tableRows: {
      chatParticipants: [{
        _id: "participant_1",
        chatId: "chat_1",
        modelId: "model_a",
        personaId: "persona_1",
      }],
    },
  });

  const result = await (createScheduledExecutionTurn as any)._handler(harness.ctx, {
    jobId: "job_1",
    chatId: "chat_1",
    userId: "user_1",
    executionId: "exec_1",
    stepIndex: 1,
    stepTitle: "Draft",
    content: "Write the summary",
    modelId: "model_a",
    personaId: "persona_1",
    personaName: "Planner",
    personaEmoji: "P",
    enabledIntegrations: ["notion"],
  });

  assert.equal(result.created, true);
  const userMessage = harness.inserts.find((entry) => entry.table === "messages" && entry.value.role === "user");
  assert.deepEqual(userMessage?.value.parentMessageIds, ["assistant_previous"]);
  assert.equal(
    harness.inserts.some((entry) => entry.table === "chatParticipants"),
    false,
  );
  assert.equal(harness.patches[0]?.value.activeStepIndex, 1);
});

test("scheduled run success and failure clear active execution state and tolerate settled cancellation", async () => {
  const success = buildCtx({
    records: {
      job_success: {
        _id: "job_success",
        userId: "user_1",
        activeExecutionId: "exec_success",
      },
      chat_1: { _id: "chat_1", userId: "user_1" },
    },
  });
  await (recordRunSuccess as any)._handler(success.ctx, {
    jobId: "job_missing",
    chatId: "chat_missing",
    startedAt: 10,
  });
  await (recordRunSuccess as any)._handler(success.ctx, {
    jobId: "job_success",
    executionId: "exec_success",
    chatId: "chat_1",
    startedAt: 10,
  });

  assert.equal(success.inserts.length, 1);
  assert.equal(success.inserts[0]?.table, "jobRuns");
  assert.equal(success.inserts[0]?.value.status, "success");
  assert.equal(success.patches[0]?.value.totalRuns, 1);
  assert.equal(success.patches[0]?.value.activeExecutionId, undefined);

  const failure = buildCtx({
    cancelThrows: true,
    records: {
      job_failed: {
        _id: "job_failed",
        userId: "user_1",
        status: "active",
        totalRuns: 2,
        activeExecutionChatId: "chat_2",
        scheduledFunctionId: "sched_old",
      },
    },
  });
  await (recordRunFailure as any)._handler(failure.ctx, {
    jobId: "job_missing",
    error: "missing",
    consecutiveFailures: 1,
    autoPause: true,
  });
  await (recordRunFailure as any)._handler(failure.ctx, {
    jobId: "job_failed",
    error: "provider failed",
    consecutiveFailures: 3,
    autoPause: true,
  });

  assert.deepEqual(failure.cancelled, ["sched_old"]);
  assert.equal(failure.inserts.length, 1);
  assert.equal(failure.inserts[0]?.value.chatId, "chat_2");
  assert.equal(failure.patches[0]?.value.status, "error");
  assert.equal(failure.patches[0]?.value.totalRuns, 3);
  assert.equal(failure.patches[0]?.value.scheduledFunctionId, undefined);
  assert.equal(failure.patches[0]?.value.nextRunAt, undefined);
});

test("scheduled run retention cleanup no-ops, deletes partial batches, and self-schedules at cap", async () => {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const emptyDeletes: string[] = [];
    await (cleanOldJobRuns as any)._handler({
      db: {
        query: () => ({
          withIndex: () => ({
            take: async () => [],
          }),
        }),
        delete: async (id: string) => {
          emptyDeletes.push(id);
        },
      },
      scheduler: { runAfter: async () => "scheduled_never" },
    });
    assert.deepEqual(emptyDeletes, []);

    const partialDeletes: string[] = [];
    let partialTakeCount = 0;
    await (cleanOldJobRuns as any)._handler({
      db: {
        query: () => ({
          withIndex: () => ({
            take: async () => {
              partialTakeCount += 1;
              return partialTakeCount === 1
                ? [{ _id: "run_old_1" }, { _id: "run_old_2" }]
                : [];
            },
          }),
        }),
        delete: async (id: string) => {
          partialDeletes.push(id);
        },
      },
      scheduler: { runAfter: async () => "scheduled_never" },
    });
    assert.deepEqual(partialDeletes, ["run_old_1", "run_old_2"]);
    assert.ok(logs.some((entry) => entry.includes("deleted 2 runs older than 30 days")));

    const cappedDeletes: string[] = [];
    const continuations: unknown[] = [];
    await (cleanOldJobRuns as any)._handler({
      db: {
        query: () => ({
          withIndex: () => ({
            take: async (limit: number) =>
              Array.from({ length: limit }, (_, index) => ({ _id: `run_batch_${cappedDeletes.length}_${index}` })),
          }),
        }),
        delete: async (id: string) => {
          cappedDeletes.push(id);
        },
      },
      scheduler: {
        runAfter: async (_delay: number, _fn: unknown, args: unknown) => {
          continuations.push(args);
          return "scheduled_cleanup";
        },
      },
    });

    assert.equal(cappedDeletes.length, 5000);
    assert.deepEqual(continuations, [{}]);
    assert.ok(logs.some((entry) => entry.includes("scheduling continuation")));
  } finally {
    console.log = originalLog;
  }
});
