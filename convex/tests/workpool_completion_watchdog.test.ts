import assert from "node:assert/strict";
import test from "node:test";
import type { MutationCtx } from "../_generated/server";

import {
  reconcileWorkpoolCompletionHandler,
  settleScheduledStepWorkFromCanonicalState,
} from
  "../execution/workpool_completion_watchdog";
import { derivePresentationWorkOutcome } from
  "../presentations/workpool_reconciliation";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import {
  isPresentationFinalizerTarget,
  PRESENTATION_FINALIZER_WATCHDOG_MS,
  WORKPOOL_WATCHDOG_INITIAL_MS,
} from "../execution/workpool_watchdog_schedule";

const target = {
  kind: "maintenance_work" as const,
  operationId: "work_1",
  runId: "run_1" as never,
};

test("presentation finalizers use the short reconciliation watchdog", () => {
  const finalizer = {
    kind: "presentation_work" as const,
    operationId: "work_1",
    runId: "run_1" as never,
    executionAttemptId: "attempt_1" as never,
    executionFence: 1,
    role: "presentation-finalizer",
  };
  const studio = { ...finalizer, role: "presentation-studio:0" };

  assert.equal(isPresentationFinalizerTarget(finalizer), true);
  assert.equal(isPresentationFinalizerTarget(studio), false);
  assert.ok(PRESENTATION_FINALIZER_WATCHDOG_MS < WORKPOOL_WATCHDOG_INITIAL_MS);
});

test("finished Workpool work invokes application-owned reconciliation", async () => {
  let reconciled = 0;
  let scheduled = 0;
  const result = await reconcileWorkpoolCompletionHandler(
    {} as never,
    { target },
    {
      isSettled: async () => false,
      isFinished: async () => true,
      reconcile: async () => {
        reconciled += 1;
      },
      schedule: async () => {
        scheduled += 1;
      },
    },
  );
  assert.equal(result, "reconciled");
  assert.equal(reconciled, 1);
  assert.equal(scheduled, 0);
});

test("Workpool watchdog retries status and reconciliation faults", async () => {
  for (const failure of ["status", "reconcile"] as const) {
    let scheduled = 0;
    const result = await reconcileWorkpoolCompletionHandler(
      {} as never,
      { target },
      {
        isSettled: async () => false,
        isFinished: async () => {
          if (failure === "status") throw new Error("status unavailable");
          return true;
        },
        reconcile: async () => {
          if (failure === "reconcile") throw new Error("write conflict");
        },
        schedule: async () => {
          scheduled += 1;
        },
      },
    );
    assert.equal(result, "rescheduled");
    assert.equal(scheduled, 1);
  }
});

test("settled domain state stops Workpool polling", async () => {
  let statusReads = 0;
  const result = await reconcileWorkpoolCompletionHandler(
    {} as never,
    { target },
    {
      isSettled: async () => true,
      isFinished: async () => {
        statusReads += 1;
        return true;
      },
      reconcile: async () => undefined,
      schedule: async () => undefined,
    },
  );
  assert.equal(result, "settled");
  assert.equal(statusReads, 0);
});

test("scheduled Workpool watchdog accepts a committed generation handoff", async () => {
  const rows = {
    scheduledJobs: [{
      _id: "scheduled_job_1",
      activeExecutionId: "execution_1",
      activeStepIndex: 2,
    }],
    searchSessions: [{
      _id: "search_session_1",
      assistantMessageId: "message_1",
      generationHandoffOperationId: "generation_workflow_1",
      status: "writing",
    }],
    executionComponentRefs: [{
      _id: "component_1",
      adapterId: "interactive-workpool",
      operationId: "search_work_1",
      status: "active",
    }],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;

  const settled = await settleScheduledStepWorkFromCanonicalState(ctx, {
    kind: "scheduled_step",
    operationId: "search_work_1",
    jobId: "scheduled_job_1" as never,
    executionId: "execution_1",
    stepIndex: 2,
    assistantMessageId: "message_1" as never,
  });

  assert.equal(settled, true);
  assert.equal(rows.executionComponentRefs[0]?.status, "completed");
  assert.equal(rows.scheduledJobs[0]?.activeExecutionId, "execution_1");
});

test("presentation worker failure cannot overwrite a committed studio batch", async () => {
  const outcome = await derivePresentationWorkOutcome({
    db: {
      get: async () => ({ _id: "run_1", status: "generating" }),
      query: (table: string) => ({
        withIndex: () => ({
          unique: async () => table === "presentationGenerationBatches"
            ? {
                _id: "batch_1",
                workpoolOperationId: "work_1",
                status: "complete",
              }
            : null,
        }),
      }),
    },
  } as never, "work_1", "run_1" as never);
  assert.equal(outcome, "completed");
});

test("presentation studio predecessor is complete after repair handoff", async () => {
  const rows = {
    presentationGenerationRuns: [{
      _id: "run_1",
      status: "generating",
      executionRunId: "execution_1",
    }],
    presentationGenerationBatches: [{
      _id: "batch_1",
      runId: "run_1",
      batchIndex: 0,
      status: "repairing",
      workpoolOperationId: "repair_work_1",
    }],
    presentationCuratorTasks: [],
    executionComponentRefs: [{
      _id: "component_1",
      runId: "execution_1",
      adapterId: "interactive-workpool",
      operationId: "studio_work_1",
      role: "presentation-studio:0",
      status: "active",
    }],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;

  assert.equal(await derivePresentationWorkOutcome(
    ctx,
    "studio_work_1",
    "run_1" as never,
  ), "completed");
});

test("presentation curator-task predecessor is complete after retry handoff", async () => {
  const rows = {
    presentationGenerationRuns: [{
      _id: "run_1",
      status: "curating",
      executionRunId: "execution_1",
    }],
    presentationGenerationBatches: [],
    presentationCuratorTasks: [{
      _id: "task_1",
      runId: "run_1",
      taskKey: "rewrite:overview",
      status: "queued",
      workpoolOperationId: "task_retry_work_1",
    }],
    executionComponentRefs: [{
      _id: "component_1",
      runId: "execution_1",
      adapterId: "interactive-workpool",
      operationId: "task_work_1",
      role: "presentation-curator-retry:rewrite:overview:1",
      status: "active",
    }],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;

  assert.equal(await derivePresentationWorkOutcome(
    ctx,
    "task_work_1",
    "run_1" as never,
  ), "completed");
});

test("presentation curator predecessor is complete after task fanout", async () => {
  const rows = {
    presentationGenerationRuns: [{
      _id: "run_1",
      status: "curating",
      executionRunId: "execution_1",
      curatorWorkpoolOperationId: "curator_work_1",
    }],
    presentationGenerationBatches: [],
    presentationCuratorTasks: [{
      _id: "task_1",
      runId: "run_1",
      taskKey: "recompose",
      status: "queued",
      workpoolOperationId: "task_work_1",
    }],
    executionComponentRefs: [{
      _id: "component_1",
      runId: "execution_1",
      adapterId: "interactive-workpool",
      operationId: "curator_work_1",
      role: "presentation-curator",
      status: "active",
    }],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;

  assert.equal(await derivePresentationWorkOutcome(
    ctx,
    "curator_work_1",
    "run_1" as never,
  ), "completed");
});
