import assert from "node:assert/strict";
import test from "node:test";

import { reconcileSubagentAdmissionWatchdogHandler } from
  "../subagents/subagent_admission_watchdog";

const args = {
  runId: "child_1",
  executionRunId: "execution_1",
  workId: "work_1",
} as never;

function context() {
  const rows: Record<string, Record<string, unknown>> = {
    child_1: {
      _id: "child_1",
      batchId: "batch_1",
      status: "queued",
      workpoolOperationId: "work_1",
    },
    batch_1: { _id: "batch_1", status: "running_children" },
    execution_1: { _id: "execution_1", activeAttemptId: "attempt_1" },
    attempt_1: { _id: "attempt_1", fence: 3 },
  };
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  return {
    rows,
    patches,
    ctx: {
      db: {
        get: async (id: string) => rows[id] ?? null,
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
          rows[id] = { ...rows[id], ...patch };
        },
      },
    } as never,
  };
}

test("finished admission without a Workflow is durably replaced", async () => {
  const { ctx, patches } = context();
  const terminalized: string[] = [];
  const linked: string[] = [];
  const scheduled: string[] = [];
  const result = await reconcileSubagentAdmissionWatchdogHandler(ctx, args, {
    isFinished: async () => true,
    enqueueReplacement: async () => "work_2",
    terminalize: async (_ctx, _adapter, operationId) => {
      terminalized.push(operationId);
      return true;
    },
    link: async (_ctx, value) => {
      linked.push(value.operationId);
      return "component_1" as never;
    },
    schedule: async (_ctx, value) => {
      scheduled.push(value.workId);
    },
  });
  assert.equal(result, "retried");
  assert.deepEqual(terminalized, ["work_1"]);
  assert.deepEqual(linked, ["work_2"]);
  assert.deepEqual(scheduled, ["work_2"]);
  assert.ok(patches.some((entry) => entry.patch.workpoolOperationId === "work_2"));
});

test("admission watchdog reschedules transient status failures", async () => {
  const { ctx } = context();
  let scheduled = 0;
  const result = await reconcileSubagentAdmissionWatchdogHandler(ctx, args, {
    isFinished: async () => {
      throw new Error("component unavailable");
    },
    enqueueReplacement: async () => "unused",
    terminalize: async () => true,
    link: async () => "component_1" as never,
    schedule: async () => {
      scheduled += 1;
    },
  });
  assert.equal(result, "rescheduled");
  assert.equal(scheduled, 1);
});

test("cancelled batches fence admission recovery", async () => {
  const { ctx, rows } = context();
  rows.batch_1 = { _id: "batch_1", status: "cancelled" };
  let replacements = 0;
  const result = await reconcileSubagentAdmissionWatchdogHandler(ctx, args, {
    isFinished: async () => true,
    enqueueReplacement: async () => {
      replacements += 1;
      return "unused";
    },
    terminalize: async () => true,
    link: async () => "component_1" as never,
    schedule: async () => undefined,
  });
  assert.equal(result, "settled");
  assert.equal(rows.child_1?.status, "cancelled");
  assert.equal(replacements, 0);
});
