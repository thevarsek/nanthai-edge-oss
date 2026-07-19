import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { durableWorkflow } from "../execution/components";
import { cancelComponent } from "../execution/teardown_components";

test("terminal Workflows are not canceled again during teardown reconciliation", async (t) => {
  t.after(() => mock.restoreAll());
  const status = mock.method(durableWorkflow, "status", async () => ({
    type: "canceled" as const,
  }));
  const cancel = mock.method(durableWorkflow, "cancel", async () => undefined);

  const cancelled = await cancelComponent(
    {} as never,
    "convex-workflow",
    "workflow_1",
  );

  assert.equal(cancelled, true);
  assert.equal(status.mock.callCount(), 1);
  assert.equal(cancel.mock.callCount(), 0);
});

test("running Workflows receive one cancellation request", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(durableWorkflow, "status", async () => ({
    type: "inProgress" as const,
    running: [],
  }));
  const cancel = mock.method(durableWorkflow, "cancel", async () => undefined);

  const cancelled = await cancelComponent(
    {} as never,
    "convex-workflow",
    "workflow_1",
  );

  assert.equal(cancelled, true);
  assert.equal(cancel.mock.callCount(), 1);
});
