import assert from "node:assert/strict";
import test from "node:test";

import {
  beginExecution,
  replaceScheduledFunction,
  triggerJobViaApi,
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
  const scheduled: Array<{ delay: number; payload: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      get: async (id: string) => records.get(id) ?? null,
      query: (table: string) => ({
        withIndex: (_index: string, apply?: (q: any) => unknown) => {
          const q = { eq: () => q };
          apply?.(q);
          return {
            first: async () => (tableRows.get(table) ?? [])[0] ?? null,
          };
        },
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = `${table}_${inserts.length + 1}`;
        inserts.push({ table, value, id });
        records.set(id, { _id: id, ...value });
        return id;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
        records.set(id, { ...(records.get(id) ?? { _id: id }), ...value });
      },
    },
    scheduler: {
      runAfter: async (delay: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push({ delay, payload });
        return `scheduled_${scheduled.length}`;
      },
      cancel: async (id: string) => {
        cancelled.push(id);
        if (options?.cancelThrows) throw new Error("already settled");
      },
    },
  } as never;

  return { ctx, inserts, patches, cancelled, scheduled };
}

test("beginExecution accepts only idle jobs and stores execution variables", async () => {
  const begin = buildCtx({
    records: {
      job_active: { _id: "job_active", activeExecutionId: "existing" },
      job_idle: { _id: "job_idle" },
    },
  });

  assert.deepEqual(await (beginExecution as any)._handler(begin.ctx, {
    jobId: "missing",
    executionId: "exec_missing",
    startedAt: 10,
    stepCount: 1,
  }), { started: false });
  assert.deepEqual(await (beginExecution as any)._handler(begin.ctx, {
    jobId: "job_active",
    executionId: "exec_blocked",
    startedAt: 10,
    stepCount: 1,
  }), { started: false });
  assert.deepEqual(await (beginExecution as any)._handler(begin.ctx, {
    jobId: "job_idle",
    executionId: "exec_1",
    startedAt: 10,
    stepCount: 2,
    templateVariables: { topic: "billing" },
  }), { started: true });

  assert.equal(begin.patches[0]?.value.activeExecutionId, "exec_1");
  assert.deepEqual(begin.patches[0]?.value.activeExecutionVariables, { topic: "billing" });
});

test("triggerJobViaApi enforces idempotency and records token usage on accepted triggers", async () => {
  const duplicate = buildCtx({
    tableRows: {
      scheduledJobApiInvocations: [{ _id: "inv_1", requestId: "request_old" }],
    },
  });
  const duplicateResult = await (triggerJobViaApi as any)._handler(duplicate.ctx, {
    jobId: "job_1",
    userId: "user_1",
    tokenId: "token_1",
    requestId: "request_2",
    idempotencyKey: "  idem-1  ",
    variables: { topic: "finance" },
  });
  assert.equal(duplicateResult.duplicate, true);
  assert.equal(duplicate.inserts[0]?.value.status, "duplicate");
  assert.equal(duplicate.scheduled.length, 0);

  const triggered = buildCtx();
  const triggeredResult = await (triggerJobViaApi as any)._handler(triggered.ctx, {
    jobId: "job_1",
    userId: "user_1",
    tokenId: "token_1",
    requestId: "request_3",
    idempotencyKey: " ",
    variables: { topic: "finance" },
  });
  assert.deepEqual(triggeredResult, {
    duplicate: false,
    triggered: true,
    message: "Scheduled job execution triggered.",
  });
  assert.equal(triggered.inserts[0]?.value.idempotencyKey, undefined);
  assert.equal(triggered.inserts[0]?.value.status, "triggered");
  assert.equal(triggered.patches[0]?.id, "token_1");
});

test("replaceScheduledFunction updates next run state and cancels only stale function ids", async () => {
  const replace = buildCtx({ cancelThrows: true });

  await (replaceScheduledFunction as any)._handler(replace.ctx, {
    jobId: "job_1",
    nextRunAt: 123,
    scheduledFunctionId: "sched_new",
    previousScheduledFunctionId: "sched_old",
  });
  await (replaceScheduledFunction as any)._handler(replace.ctx, {
    jobId: "job_1",
    nextRunAt: 456,
    scheduledFunctionId: "sched_same",
    previousScheduledFunctionId: "sched_same",
  });

  assert.deepEqual(replace.cancelled, ["sched_old"]);
  assert.equal(replace.patches[0]?.value.scheduledFunctionId, "sched_new");
  assert.equal(replace.patches[1]?.value.scheduledFunctionId, "sched_same");
});
