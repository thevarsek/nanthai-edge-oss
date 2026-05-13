import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";

import {
  beginExecution,
  cancelScheduledFunction,
  cleanOldJobRuns,
  createJob,
  recordRunFailure,
  resumeJob,
  runJobNow,
  updateJob,
} from "../scheduledJobs/mutations";

type Row = Record<string, any>;

function buildCtx(options?: {
  records?: Record<string, Row>;
  tableRows?: Record<string, Row[]>;
  cancelThrows?: boolean;
}) {
  const records = new Map(Object.entries(options?.records ?? {}));
  const tableRows = new Map(Object.entries(options?.tableRows ?? {}));
  const patches: Array<{ id: string; value: Row }> = [];
  const inserts: Array<{ table: string; value: Row; id: string }> = [];
  const deletes: string[] = [];
  const cancelled: string[] = [];
  const scheduledAfter: Array<{ delay: number; args: Row }> = [];
  const scheduledAt: Array<{ at: number; args: Row }> = [];

  const rowsFor = (table: string) => tableRows.get(table) ?? [];
  const chainFor = (table: string) => {
    const chain = {
      withIndex: (_index: string, apply?: (q: any) => unknown) => {
        const q = { eq: () => q, lt: () => q, field: (name: string) => name };
        apply?.(q);
        return chain;
      },
      filter: () => chain,
      first: async () => rowsFor(table)[0] ?? null,
      unique: async () => rowsFor(table)[0] ?? null,
      collect: async () => rowsFor(table),
      take: async (count: number) => {
        const rows = rowsFor(table);
        const batch = rows.slice(0, count);
        tableRows.set(table, rows.slice(count));
        return batch;
      },
    };
    return chain;
  };

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => records.get(id) ?? null,
      query: (table: string) => chainFor(table),
      insert: async (table: string, value: Row) => {
        const id = `${table}_${inserts.length + 1}`;
        inserts.push({ table, value, id });
        records.set(id, { _id: id, ...value });
        tableRows.set(table, [...rowsFor(table), { _id: id, ...value }]);
        return id;
      },
      patch: async (id: string, value: Row) => {
        patches.push({ id, value });
        records.set(id, { ...(records.get(id) ?? { _id: id }), ...value });
      },
      delete: async (id: string) => {
        deletes.push(id);
        records.delete(id);
      },
    },
    scheduler: {
      runAfter: async (delay: number, _ref: unknown, args: Row) => {
        scheduledAfter.push({ delay, args });
        return `after_${scheduledAfter.length}`;
      },
      runAt: async (at: number, _ref: unknown, args: Row) => {
        scheduledAt.push({ at, args });
        return `at_${scheduledAt.length}`;
      },
      cancel: async (id: string) => {
        cancelled.push(id);
        if (options?.cancelThrows) throw new Error("already settled");
      },
    },
  } as any;

  return { ctx, records, tableRows, patches, inserts, deletes, cancelled, scheduledAfter, scheduledAt };
}

const proRows = {
  purchaseEntitlements: [{ _id: "ent_1", userId: "user_1", status: "active" }],
};

test("public scheduled job mutations reject invalid names, recurrence, ownership, and paused manual run-now", async () => {
  const base = buildCtx({ tableRows: proRows });

  await assert.rejects(
    (createJob as any)._handler(base.ctx, {
      name: " ",
      prompt: "Run",
      modelId: "model_1",
      recurrence: { type: "manual" },
    }),
    /Job name is required/,
  );
  await assert.rejects(
    (createJob as any)._handler(base.ctx, {
      name: "x".repeat(201),
      prompt: "Run",
      modelId: "model_1",
      recurrence: { type: "manual" },
    }),
    /Job name too long/,
  );
  await assert.rejects(
    (createJob as any)._handler(base.ctx, {
      name: "Bad recurrence",
      prompt: "Run",
      modelId: "model_1",
      recurrence: { type: "interval", minutes: 0 },
    }),
    /Invalid recurrence/,
  );

  const pausedManual = buildCtx({
    records: {
      job_1: { _id: "job_1", userId: "user_1", status: "paused", recurrence: { type: "manual" } },
    },
    tableRows: proRows,
  });
  await assert.rejects(
    (runJobNow as any)._handler(pausedManual.ctx, { jobId: "job_1" }),
    /Cannot run a paused manual job/,
  );

  await assert.rejects(
    (updateJob as any)._handler(base.ctx, { jobId: "missing", name: "Next" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );
});

test("scheduled job update and resume handle step validation, target clears, and manual recurrence branches", async () => {
  const state = buildCtx({
    records: {
      job_1: {
        _id: "job_1",
        userId: "user_1",
        name: "Existing",
        prompt: "Old",
        modelId: "model_1",
        recurrence: { type: "manual" },
        timezone: "UTC",
        status: "paused",
        targetFolderId: "folder_1",
        totalRuns: 0,
      },
    },
    tableRows: proRows,
  });

  await assert.rejects(
    (updateJob as any)._handler(state.ctx, {
      jobId: "job_1",
      steps: [{ prompt: "", modelId: "model_1" }],
    }),
    /Step 1 prompt is required/,
  );
  await assert.rejects(
    (updateJob as any)._handler(state.ctx, {
      jobId: "job_1",
      steps: [{ prompt: "Run", modelId: "" }],
    }),
    /Step 1 model is required/,
  );

  await (updateJob as any)._handler(state.ctx, {
    jobId: "job_1",
    name: "Updated",
    targetFolderId: null,
    status: "active",
  });
  assert.equal(state.patches.at(-1)?.value.targetFolderId, undefined);
  assert.equal(state.patches.at(-1)?.value.scheduledFunctionId, undefined);

  await (resumeJob as any)._handler(state.ctx, { jobId: "job_1" });
  assert.equal(state.patches.at(-1)?.value.status, "active");
  assert.equal(state.patches.at(-1)?.value.scheduledFunctionId, undefined);
});

test("beginExecution, failure recording, cancellation, and cleanup preserve lifecycle invariants", async () => {
  const noJob = buildCtx();
  assert.deepEqual(await (beginExecution as any)._handler(noJob.ctx, {
    jobId: "missing",
    executionId: "exec_1",
    startedAt: 10,
    stepCount: 2,
  }), { started: false });

  const active = buildCtx({
    records: { job_1: { _id: "job_1", activeExecutionId: "exec_existing" } },
  });
  assert.deepEqual(await (beginExecution as any)._handler(active.ctx, {
    jobId: "job_1",
    executionId: "exec_2",
    startedAt: 11,
    stepCount: 2,
  }), { started: false });

  const lifecycle = buildCtx({
    records: {
      job_2: {
        _id: "job_2",
        userId: "user_1",
        status: "active",
        scheduledFunctionId: "scheduled_1",
        activeExecutionChatId: "chat_1",
        activeExecutionStartedAt: Date.now() - 500,
        totalRuns: 4,
      },
    },
    tableRows: {
      jobRuns: [],
      oldRuns: [],
    },
    cancelThrows: true,
  });
  assert.deepEqual(await (beginExecution as any)._handler(lifecycle.ctx, {
    jobId: "job_2",
    executionId: "exec_3",
    startedAt: 12,
    stepCount: 2,
  }), { started: true });
  assert.equal(lifecycle.patches[0].value.activeExecutionVariables, undefined);

  await (recordRunFailure as any)._handler(lifecycle.ctx, {
    jobId: "job_2",
    executionId: "exec_3",
    error: "boom",
    consecutiveFailures: 3,
    autoPause: true,
  });
  assert.equal(lifecycle.cancelled[0], "scheduled_1");
  assert.equal(lifecycle.patches.at(-1)?.value.status, "error");
  assert.equal(lifecycle.patches.at(-1)?.value.scheduledFunctionId, undefined);

  await (cancelScheduledFunction as any)._handler(lifecycle.ctx, {
    jobId: "job_2",
    scheduledFunctionId: "scheduled_1",
  });
  assert.equal(lifecycle.patches.at(-1)?.value.scheduledFunctionId, undefined);
});

test("cleanOldJobRuns exits cleanly with no rows and self-schedules after capped full batches", async () => {
  const empty = buildCtx({ tableRows: { jobRuns: [] } });
  await (cleanOldJobRuns as any)._handler(empty.ctx, {});
  assert.deepEqual(empty.deletes, []);
  assert.deepEqual(empty.scheduledAfter, []);

  const fullBatches = Array.from({ length: 5000 }, (_, index) => ({ _id: `run_${index}` }));
  const capped = buildCtx({ tableRows: { jobRuns: fullBatches } });
  await (cleanOldJobRuns as any)._handler(capped.ctx, {});
  assert.equal(capped.deletes.length, 5000);
  assert.deepEqual(capped.scheduledAfter, [{ delay: 0, args: {} }]);
});
