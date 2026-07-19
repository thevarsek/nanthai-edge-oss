import assert from "node:assert/strict";
import test from "node:test";

import { reconcileOwnedWorkflowWatchdogHandler } from
  "../execution/owned_workflow_watchdog";

function ctx(componentStatus = "active") {
  return {
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => ({ status: componentStatus }),
        }),
      }),
    },
  };
}

test("owned Workflow watchdog replays a lost terminal callback", async () => {
  const reconciled: Array<Record<string, unknown>> = [];
  let scheduled = 0;
  const result = await reconcileOwnedWorkflowWatchdogHandler(
    ctx() as never,
    { workflowId: "workflow_1", context: {} },
    {
      status: async () => ({ type: "failed", error: "workflow failed" }),
      reconcile: async (_ctx, args) => {
        reconciled.push(args as unknown as Record<string, unknown>);
        return null;
      },
      schedule: async () => {
        scheduled += 1;
      },
    },
  );
  assert.equal(result, "reconciled");
  assert.deepEqual(reconciled[0]?.result, {
    kind: "failed",
    error: "workflow failed",
  });
  assert.equal(scheduled, 1);
});

test("owned Workflow watchdog keeps polling after transient observation failures", async () => {
  let scheduled = 0;
  const result = await reconcileOwnedWorkflowWatchdogHandler(
    ctx() as never,
    { workflowId: "workflow_1", context: {} },
    {
      status: async () => {
        throw new Error("component unavailable");
      },
      reconcile: async () => null,
      schedule: async () => {
        scheduled += 1;
      },
    },
  );
  assert.equal(result, "rescheduled");
  assert.equal(scheduled, 1);
});

test("owned Workflow watchdog stops after lifecycle reconciliation settles", async () => {
  let statusReads = 0;
  const result = await reconcileOwnedWorkflowWatchdogHandler(
    ctx("completed") as never,
    { workflowId: "workflow_1", context: {} },
    {
      status: async () => {
        statusReads += 1;
        return { type: "completed", result: null };
      },
      reconcile: async () => null,
      schedule: async () => undefined,
    },
  );
  assert.equal(result, "settled");
  assert.equal(statusReads, 0);
});
