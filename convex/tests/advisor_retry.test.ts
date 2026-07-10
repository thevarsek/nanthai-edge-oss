import assert from "node:assert/strict";
import test from "node:test";
import { reuseAdvisorBatchForRetry } from "../advisors/retry";

type RetryArgs = Parameters<typeof reuseAdvisorBatchForRetry>[1];

function retryFixture(
  batch: Record<string, unknown>,
  runs: Array<Record<string, unknown>>,
) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      get: async () => batch,
      query: () => ({
        withIndex: () => ({ collect: async () => runs }),
      }),
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
    },
  } as unknown as Parameters<typeof reuseAdvisorBatchForRetry>[0];
  return { ctx, patches };
}

async function reuseWith(
  fixture: ReturnType<typeof retryFixture>,
): Promise<string | null> {
  return await reuseAdvisorBatchForRetry(fixture.ctx, {
    sourceMessage: { advisorBatchId: "batch_1" } as unknown as RetryArgs["sourceMessage"],
    targetMessageIds: ["retry_1", "retry_2"] as RetryArgs["targetMessageIds"],
    userId: "user_1",
  }) as string | null;
}

test("final-answer retries reuse completed and synthesizing terminal Advisor batches", async () => {
  for (const status of ["synthesizing", "completed"]) {
    const fixture = retryFixture(
      { _id: "batch_1", userId: "user_1", status },
      [{ _id: "run_1", status: "completed" }],
    );
    assert.equal(await reuseWith(fixture), "batch_1");
    assert.deepEqual(fixture.patches, [
      { id: "retry_1", patch: { advisorBatchId: "batch_1" } },
      { id: "retry_2", patch: { advisorBatchId: "batch_1" } },
    ]);
  }
});

test("a cancelled batch reuses its completed advice when every run is terminal", async () => {
  const fixture = retryFixture(
    { _id: "batch_1", userId: "user_1", status: "cancelled" },
    [
      { _id: "run_1", status: "completed" },
      { _id: "run_2", status: "cancelled" },
    ],
  );
  assert.equal(await reuseWith(fixture), "batch_1");
});

test("active, foreign, empty, or partially active Advisor batches are never reused", async () => {
  for (const scenario of [
    {
      batch: { _id: "batch_1", userId: "other", status: "completed" },
      runs: [{ _id: "run_1", status: "completed" }],
    },
    {
      batch: { _id: "batch_1", userId: "user_1", status: "running" },
      runs: [{ _id: "run_1", status: "running" }],
    },
    {
      batch: { _id: "batch_1", userId: "user_1", status: "cancelled" },
      runs: [{ _id: "run_1", status: "consulting" }],
    },
    {
      batch: { _id: "batch_1", userId: "user_1", status: "failed" },
      runs: [],
    },
  ]) {
    const fixture = retryFixture(scenario.batch, scenario.runs);
    assert.equal(await reuseWith(fixture), null);
    assert.deepEqual(fixture.patches, []);
  }
});
