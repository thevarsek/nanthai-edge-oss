import assert from "node:assert/strict";
import test from "node:test";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  cancelRunTreeRetryDelay,
  finishComponentCancellationHandler,
  isComponentCancellationConfirmed,
} from "../execution/teardown";
import { reconcileOwnedWorkflowHandler } from "../execution/workflow_lifecycle";
import { deletionTeardownRetryDelay } from
  "../execution/teardown_delete_handlers";

test("a canceled Workflow callback waits for component drain before terminalizing", async () => {
  const ref = {
    _id: "component_1",
    runId: "run_1",
    attemptId: "attempt_1",
    status: "active",
    cancelSafeAfter: 9_999_999_999_999,
    cancelAcknowledgedAt: 123,
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
  assert.equal(patches[0]?.value.cancelSafeAfter, ref.cancelSafeAfter);
  assert.equal(patches[0]?.value.cancelAcknowledgedAt, ref.cancelAcknowledgedAt);
  assert.equal(attempt.status, "running");
  assert.equal(run.state, "cancelling");
});

test("a terminal callback acknowledges cancellation after Workflow cleanup", () => {
  assert.equal(isComponentCancellationConfirmed(false, Date.now()), true);
  assert.equal(isComponentCancellationConfirmed(false, undefined), false);
  assert.equal(isComponentCancellationConfirmed(true, undefined), true);
});

test("acknowledged action cancellation terminalizes after its safe boundary", async () => {
  const ref = {
    _id: "component_1",
    runId: "run_1",
    adapterId: "convex-workflow",
    status: "cancel_requested",
    cancelSafeAfter: 1,
  };
  const run = { _id: "run_1", state: "cancelled" };
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      get: async (id: string) => id === ref._id ? ref : id === run._id ? run : null,
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  } as unknown as MutationCtx;

  await finishComponentCancellationHandler(ctx, {
    componentRefId: ref._id as Id<"executionComponentRefs">,
    cancelled: true,
  });

  assert.equal(patches.length, 1);
  assert.equal(patches[0]?.id, ref._id);
  assert.equal(patches[0]?.value.status, "cancelled");
  assert.equal(typeof patches[0]?.value.terminalAt, "number");
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

test("deletion teardown sleeps until the latest acknowledged drain boundary", () => {
  const now = 1_000;
  assert.equal(deletionTeardownRetryDelay([], now), 1_000);
  assert.equal(deletionTeardownRetryDelay([
    { cancelSafeAfter: now + 30_000 },
    { cancelSafeAfter: now + 60_000 },
  ], now), 60_000);
});
