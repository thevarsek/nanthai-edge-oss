import assert from "node:assert/strict";
import test from "node:test";

import { reconcileSubagentContinuationHandler } from
  "../subagents/subagent_continuation_recovery";

test("failed legacy continuation callback durably schedules an exact replacement", async () => {
  const scheduled: Array<{ delay: number; args: Record<string, unknown> }> = [];
  await reconcileSubagentContinuationHandler({
    db: {
      get: async () => ({
        _id: "run_1",
        status: "waiting_continuation",
        workpoolOperationId: "work_1",
      }),
      query: () => ({
        withIndex: () => ({ unique: async () => null }),
      }),
    },
    scheduler: {
      runAfter: async (delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push({ delay, args });
        return "scheduled_1";
      },
    },
  } as never, {
    workId: "work_1",
    context: { runId: "run_1" as never },
    result: { kind: "failed", error: "worker result lost" },
  });
  assert.deepEqual(scheduled, [{
    delay: 0,
    args: { runId: "run_1", expectedWorkId: "work_1" },
  }]);
});
