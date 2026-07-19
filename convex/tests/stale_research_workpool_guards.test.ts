import assert from "node:assert/strict";
import test from "node:test";

import type { MutationCtx } from "../_generated/server";
import { completeResearchSearchTask } from "../search/research_fanout_mutations";

type TestRow = Record<string, unknown> & { _id: string };

test("the terminal research Workpool callback signals its Workflow once", async () => {
  const rows = new Map<string, TestRow>([
    ["task_1", {
      _id: "task_1",
      batchId: "batch_1",
      sessionId: "session_1",
      status: "queued",
    }],
    ["batch_1", {
      _id: "batch_1",
      sessionId: "session_1",
      status: "running",
      expectedCount: 1,
      terminalCount: 0,
      failedCount: 0,
    }],
    ["session_1", {
      _id: "session_1",
      status: "searching",
      workflowId: "workflow_1",
      executionAttemptId: "attempt_1",
      executionFence: 4,
      executionClaimantId: "research-workflow:workflow_1",
    }],
    ["attempt_1", {
      _id: "attempt_1",
      runId: "execution_1",
      claimantId: "research-workflow:workflow_1",
      fence: 4,
      status: "running",
    }],
    ["execution_1", {
      _id: "execution_1",
      activeAttemptId: "attempt_1",
      state: "running",
    }],
  ]);
  const events: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      get: async (id: string) => rows.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        const row = rows.get(id);
        if (row) rows.set(id, { ...row, ...patch });
      },
      query: () => ({
        withIndex: () => ({
          collect: async () => [rows.get("task_1")],
          unique: async () => null,
        }),
      }),
    },
    runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
      events.push(args);
      return "event_1";
    },
  } as unknown as MutationCtx;
  const handler = (completeResearchSearchTask as unknown as {
    _handler: (
      context: MutationCtx,
      args: Record<string, unknown>,
    ) => Promise<void>;
  })._handler;
  const args = {
    context: {
      taskId: "task_1",
      batchId: "batch_1",
      executionAttemptId: "attempt_1",
      executionFence: 4,
    },
    result: { kind: "success", returnValue: { success: true } },
  };

  await handler(ctx, args);
  await handler(ctx, args);

  assert.equal(rows.get("task_1")?.status, "completed");
  assert.equal(rows.get("batch_1")?.status, "completed");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.name, "research-search-batch-terminal:batch_1");
});
