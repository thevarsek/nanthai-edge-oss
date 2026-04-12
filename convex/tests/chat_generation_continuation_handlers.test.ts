import assert from "node:assert/strict";
import test from "node:test";

import { setGenerationContinuationScheduledHandler } from "../chat/mutations_generation_continuation_handlers";

test("setGenerationContinuationScheduledHandler does not overwrite a claimed continuation", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const continuation = {
    _id: "cont_1",
    status: "running",
  };
  const job = {
    _id: "job_1",
  };

  const ctx = {
    db: {
      query: (_table: string) => ({
        withIndex: (_index: string, _apply: unknown) => ({
          first: async () => continuation,
        }),
      }),
      get: async (id: string) => (id === "job_1" ? job : null),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
    scheduler: {},
  } as any;

  await setGenerationContinuationScheduledHandler(ctx, {
    jobId: "job_1" as any,
    scheduledFunctionId: "sched_1" as any,
  });

  assert.deepEqual(patches, [{
    id: "job_1",
    value: {
      scheduledFunctionId: "sched_1",
    },
  }]);
});
