import assert from "node:assert/strict";
import test from "node:test";

import {
  commitScheduledExecutionFailure,
  commitScheduledExecutionSuccess,
} from "../scheduledJobs/execution_terminal_commit";

function buildHarness(job: Record<string, unknown>) {
  const records = new Map<string, Record<string, unknown>>([
    [String(job._id), job],
    ["chat_1", { _id: "chat_1", userId: "user_1" }],
  ]);
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      get: async (id: string) => records.get(id) ?? null,
      query: () => ({
        withIndex: () => ({ unique: async () => null }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return `${table}_${inserts.length}`;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        records.set(id, { ...(records.get(id) ?? { _id: id }), ...value });
      },
    },
    scheduler: { cancel: async () => undefined },
  } as never;
  return { ctx, records, inserts };
}

test("scheduled success atomically records and clears the active occurrence", async () => {
  const harness = buildHarness({
    _id: "scheduled_1",
    userId: "user_1",
    status: "active",
    activeExecutionId: "execution_1",
    activeExecutionStartedAt: 10,
    totalRuns: 2,
  });
  const args = {
    jobId: "scheduled_1",
    executionId: "execution_1",
    chatId: "chat_1",
  };
  assert.equal(
    await (commitScheduledExecutionSuccess as any)._handler(harness.ctx, args),
    true,
  );
  assert.equal(harness.inserts.length, 1);
  assert.equal(harness.inserts[0]?.value.status, "success");
  assert.equal(harness.records.get("scheduled_1")?.activeExecutionId, undefined);
  assert.equal(harness.records.get("scheduled_1")?.totalRuns, 3);
  assert.equal(
    await (commitScheduledExecutionSuccess as any)._handler(harness.ctx, args),
    false,
  );
  assert.equal(harness.inserts.length, 1);
});

test("scheduled failure atomically records, auto-pauses, and fences duplicates", async () => {
  const harness = buildHarness({
    _id: "scheduled_1",
    userId: "user_1",
    status: "active",
    activeExecutionId: "execution_1",
    activeExecutionStartedAt: 10,
    activeExecutionChatId: "chat_1",
    consecutiveFailures: 2,
    totalRuns: 4,
    scheduledFunctionId: "scheduled_function_1",
  });
  const args = {
    jobId: "scheduled_1",
    executionId: "execution_1",
    error: "provider unavailable",
  };
  assert.equal(
    await (commitScheduledExecutionFailure as any)._handler(harness.ctx, args),
    true,
  );
  assert.equal(harness.inserts.length, 1);
  assert.equal(harness.inserts[0]?.value.status, "failed");
  assert.equal(harness.records.get("scheduled_1")?.status, "error");
  assert.equal(harness.records.get("scheduled_1")?.activeExecutionId, undefined);
  assert.equal(
    await (commitScheduledExecutionFailure as any)._handler(harness.ctx, args),
    false,
  );
  assert.equal(harness.inserts.length, 1);
});
