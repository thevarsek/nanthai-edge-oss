import assert from "node:assert/strict";
import test from "node:test";
import type { Doc } from "../_generated/dataModel";
import { projectExecution } from "../execution/projection";

test("execution projection uses backend-authored local waiting state", () => {
  const projection = projectExecution(
    {
      _id: "run_1",
      state: "waiting_for_permission",
      requestedPlacement: "cloud",
      updatedAt: 129,
    } as Doc<"executionRuns">,
    {
      _id: "attempt_1",
      executorKind: "local_runtime",
      placement: "local",
      runtimeLabel: "Dino's Mac",
      provider: "openrouter",
      modelId: "openai/gpt-5",
    } as Doc<"executionAttempts">,
    {
      type: "permission_required",
      summary: "Allow workspace write",
    } as unknown as Doc<"runEvents">,
  );

  assert.equal(projection.placement, "local");
  assert.equal(projection.needsPermission, true);
  assert.equal(projection.cancelAvailable, true);
  assert.equal(projection.lastEventSummary, "Allow workspace write");
});

test("terminal execution projection cannot be cancelled", () => {
  const projection = projectExecution(
    {
      _id: "run_2",
      state: "completed",
      requestedPlacement: "cloud",
      terminalOutcome: "completed",
      updatedAt: 200,
    } as Doc<"executionRuns">,
    null,
    null,
  );
  assert.equal(projection.cancelAvailable, false);
  assert.equal(projection.terminalOutcome, "completed");
});
