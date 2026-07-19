import assert from "node:assert/strict";
import test from "node:test";

import { reconcileSubagentWorkflowHandler } from "../subagents/workflow_lifecycle";

for (const batchStatus of ["waiting_to_resume", "resuming"] as const) {
  test(`terminal child recovery schedules its parent from ${batchStatus}`, async () => {
    const scheduled: Array<{ delay: number; args: Record<string, unknown> }> = [];
    const ctx = {
      db: {
        get: async (id: string) => id === "run_1"
          ? {
              _id: "run_1",
              batchId: "batch_1",
              status: "completed",
              workflowId: "workflow_1",
            }
          : { _id: "batch_1", status: batchStatus },
        query: () => ({
          withIndex: () => ({
            collect: async () => [{ _id: "run_1", status: "completed" }],
          }),
        }),
        patch: async () => undefined,
      },
      scheduler: {
        runAfter: async (delay: number, _ref: unknown, args: Record<string, unknown>) => {
          scheduled.push({ delay, args });
          return "scheduled_1";
        },
      },
    };

    await reconcileSubagentWorkflowHandler(ctx as never, {
      workflowId: "workflow_1",
      result: { kind: "failed", error: "parent handoff failed" },
      context: { runId: "run_1" as never },
    });

    const parentResumes = scheduled.filter((entry) => entry.args.batchId === "batch_1");
    assert.equal(parentResumes.length, 2);
    assert.equal(parentResumes[0]?.delay, 0);
    assert.equal(parentResumes[1]?.delay > 0, true);
  });
}

test("lost action result chains a committed continuation checkpoint", async () => {
  const scheduled: Array<{ args: Record<string, unknown> }> = [];
  const docs: Record<string, Record<string, unknown>> = {
    run_1: {
      _id: "run_1",
      batchId: "batch_1",
      status: "waiting_continuation",
      workflowId: "workflow_1",
      continuationCount: 7,
    },
    batch_1: { _id: "batch_1", status: "running_children" },
    attempt_1: { _id: "attempt_1", fence: 4 },
  };
  await reconcileSubagentWorkflowHandler({
    db: {
      get: async (id: string) => docs[id] ?? null,
      query: () => ({
        withIndex: () => ({
          unique: async () => ({
            runId: "execution_run_1",
            attemptId: "attempt_1",
          }),
        }),
      }),
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push({ args });
        return "scheduled_1";
      },
    },
  } as never, {
    workflowId: "workflow_1",
    result: { kind: "failed", error: "result delivery lost" },
    context: { runId: "run_1" as never },
  });
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]?.args.predecessorWorkflowId, "workflow_1");
  assert.equal(scheduled[0]?.args.nextInvocationOffset, "7");
  assert.equal(scheduled[0]?.args.executionRunId, "execution_run_1");
});
