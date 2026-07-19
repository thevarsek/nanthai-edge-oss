import assert from "node:assert/strict";
import test from "node:test";

import type { MutationCtx } from "../_generated/server";
import {
  cancelRunTreeRetryDelay,
  isComponentCancellationConfirmed,
} from "../execution/teardown";
import { reconcileOwnedWorkflowHandler } from "../execution/workflow_lifecycle";

test("a canceled Workflow callback waits for component drain before terminalizing", async () => {
  const ref = {
    _id: "component_1",
    runId: "run_1",
    attemptId: "attempt_1",
    status: "active",
  };
  const attempt = { _id: "attempt_1", runId: "run_1", fence: 3, status: "running" };
  const run = { _id: "run_1", activeAttemptId: "attempt_1", state: "cancelling" };
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      query: () => ({ withIndex: () => ({ unique: async () => ref }) }),
      get: async (id: string) => id === attempt._id ? attempt : id === run._id ? run : null,
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
    scheduler: { runAfter: async () => "scheduled_1" },
  } as unknown as MutationCtx;

  await reconcileOwnedWorkflowHandler(ctx, {
    workflowId: "workflow_1",
    result: { kind: "canceled" },
    context: {},
  });

  assert.equal(patches.length, 1);
  assert.equal(patches[0]?.id, "component_1");
  assert.equal(patches[0]?.value.status, "cancel_requested");
  assert.equal(typeof patches[0]?.value.cancelSafeAfter, "number");
  assert.equal(typeof patches[0]?.value.cancelAcknowledgedAt, "number");
  assert.equal(attempt.status, "running");
  assert.equal(run.state, "cancelling");
});

test("a terminal callback acknowledges cancellation after Workflow cleanup", () => {
  assert.equal(isComponentCancellationConfirmed(false, Date.now()), true);
  assert.equal(isComponentCancellationConfirmed(false, undefined), false);
  assert.equal(isComponentCancellationConfirmed(true, undefined), true);
});

test("acknowledged action cancellation sleeps until its safe drain boundary", () => {
  const now = 1_000;
  assert.equal(cancelRunTreeRetryDelay([{
    adapterId: "convex-workflow",
    cancelSafeAfter: now + 11 * 60 * 1_000,
  }], true, now), 11 * 60 * 1_000);
  assert.equal(cancelRunTreeRetryDelay([{
    adapterId: "interactive-workpool",
  }], true, now), 11 * 60 * 1_000);
  assert.equal(cancelRunTreeRetryDelay([{
    adapterId: "interactive-workpool",
  }], false, now), 1_000);
  assert.equal(cancelRunTreeRetryDelay([{
    adapterId: "external-cloud",
  }], false, now), 30_000);
});
