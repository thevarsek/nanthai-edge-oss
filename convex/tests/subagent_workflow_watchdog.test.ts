import assert from "node:assert/strict";
import test from "node:test";

import { reconcileSubagentWorkflowWatchdogHandler } from
  "../subagents/subagent_workflow_watchdog";

function ctx(status = "streaming", componentStatus = "active") {
  return {
    db: {
      get: async () => ({
        _id: "run_1",
        status,
        workflowId: "workflow_1",
      }),
      query: () => ({
        withIndex: () => ({
          unique: async () => ({ status: componentStatus }),
        }),
      }),
    },
  };
}

test("subagent watchdog replays a lost failed completion", async () => {
  const results: Array<Record<string, unknown>> = [];
  const result = await reconcileSubagentWorkflowWatchdogHandler(
    ctx() as never,
    { workflowId: "workflow_1", runId: "run_1" } as never,
    {
      status: async () => ({ type: "failed", error: "child action failed" }),
      reconcile: async (_ctx, args) => {
        results.push(args as unknown as Record<string, unknown>);
        return null;
      },
      schedule: async () => undefined,
    },
  );
  assert.equal(result, "reconciled");
  assert.deepEqual(results[0]?.result, {
    kind: "failed",
    error: "child action failed",
  });
});

test("subagent watchdog reschedules transient status failures", async () => {
  let scheduled = 0;
  let reconciled = 0;
  const result = await reconcileSubagentWorkflowWatchdogHandler(
    ctx() as never,
    { workflowId: "workflow_1", runId: "run_1" } as never,
    {
      status: async () => {
        throw new Error("component unavailable");
      },
      reconcile: async () => {
        reconciled += 1;
        return null;
      },
      schedule: async () => {
        scheduled += 1;
      },
    },
  );
  assert.equal(result, "rescheduled");
  assert.equal(reconciled, 0);
  assert.equal(scheduled, 1);
});

test("subagent watchdog is inert after the child is terminal", async () => {
  const result = await reconcileSubagentWorkflowWatchdogHandler(
    ctx("completed", "completed") as never,
    { workflowId: "workflow_1", runId: "run_1" } as never,
    {
      status: async () => {
        throw new Error("must not inspect settled Workflow");
      },
      reconcile: async () => null,
      schedule: async () => undefined,
    },
  );
  assert.equal(result, "settled");
});
