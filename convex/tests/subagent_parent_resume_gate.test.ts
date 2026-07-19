import assert from "node:assert/strict";
import test from "node:test";

import {
  markBatchWaitingAndArmParentResumeHandler,
  runParentResumeGateHandler,
} from "../subagents/parent_resume_gate";

test("legacy terminal batches atomically enter waiting state with parent resume gates armed", async () => {
  const batch: Record<string, unknown> = {
    _id: "batch_1",
    status: "running_children",
  };
  const scheduled: Array<{ delay: number; args: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      get: async () => batch,
      patch: async (_id: string, patch: Record<string, unknown>) => {
        Object.assign(batch, patch);
      },
    },
    scheduler: {
      runAfter: async (delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push({ delay, args });
        return `scheduled_${scheduled.length}`;
      },
    },
  };

  const didMark = await markBatchWaitingAndArmParentResumeHandler(ctx as never, {
    batchId: "batch_1" as never,
  });

  assert.equal(didMark, true);
  assert.equal(batch.status, "waiting_to_resume");
  assert.equal(typeof batch.continuationScheduledAt, "number");
  assert.equal(batch.parentRecoveryScheduledAt, batch.continuationScheduledAt);
  assert.equal(scheduled.length, 2);
  assert.ok(scheduled.some((entry) => entry.delay === 0));
  assert.ok(scheduled.some((entry) => entry.delay > 0));
  assert.ok(scheduled.every((entry) =>
    entry.args.batchId === "batch_1" && entry.args.expectedGateAt === undefined
  ));

  assert.equal(await markBatchWaitingAndArmParentResumeHandler(ctx as never, {
    batchId: "batch_1" as never,
  }), false);
  assert.equal(scheduled.length, 2);
});

test("parent resume gate atomically dispatches and arms its successor", async () => {
  const batch: Record<string, unknown> = {
    _id: "batch_1",
    status: "waiting_to_resume",
  };
  const scheduled: Array<{ delay: number; args: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      get: async () => batch,
      patch: async (_id: string, patch: Record<string, unknown>) => {
        Object.assign(batch, patch);
      },
    },
    scheduler: {
      runAfter: async (delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push({ delay, args });
        return `scheduled_${scheduled.length}`;
      },
    },
  };
  const result = await runParentResumeGateHandler(ctx as never, {
    batchId: "batch_1" as never,
  });
  assert.equal(result, "dispatched");
  assert.equal(typeof batch.parentRecoveryGateAt, "number");
  assert.equal(scheduled.length, 2);
  assert.ok(scheduled.some((entry) => entry.delay === 0));
  assert.ok(scheduled.some((entry) => entry.delay > 0));

  const stale = await runParentResumeGateHandler(ctx as never, {
    batchId: "batch_1" as never,
  });
  assert.equal(stale, "superseded");
  assert.equal(scheduled.length, 2);
});
