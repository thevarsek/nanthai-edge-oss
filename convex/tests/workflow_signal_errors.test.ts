import assert from "node:assert/strict";
import test from "node:test";

import { isSettledWorkflowSignalError } from
  "../execution/workflow_signal_errors";

test("settled Workflow and consumed event errors are replay-safe", () => {
  assert.equal(
    isSettledWorkflowSignalError(
      new Error("Workflow not running: [object Object]"),
    ),
    true,
  );
  assert.equal(
    isSettledWorkflowSignalError(new Error("Event already consumed")),
    true,
  );
  assert.equal(
    isSettledWorkflowSignalError(new Error("validator rejected payload")),
    false,
  );
  assert.equal(
    isSettledWorkflowSignalError(
      new Error("ArgumentValidationError: extra field completedAt"),
    ),
    false,
  );
  assert.equal(
    isSettledWorkflowSignalError(
      new Error("Workflow event validator rejected completed value"),
    ),
    false,
  );
});
