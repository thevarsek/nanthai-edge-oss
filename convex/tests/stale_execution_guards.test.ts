import assert from "node:assert/strict";
import test from "node:test";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createAutonomousMessageHandler } from "../autonomous/mutations_helpers";
import { isCurrentResearchExecution } from "../search/execution_lifecycle";
import { isCurrentSubagentExecution } from "../subagents/execution_fence";
import { finalizeRun } from "../subagents/mutations";
import { reconcileSubagentWorkflow } from "../subagents/workflow_lifecycle";
import { continueDurableParentAfterSubagents } from "../subagents/durable_parent_resume";

type TestRow = Record<string, unknown> & { _id: string };

test("cancelled subagent rows reject late finalization without resuming the parent", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const run = {
    _id: "child_1",
    batchId: "batch_1",
    status: "cancelled",
  } as unknown as Doc<"subagentRuns">;
  const ctx = {
    db: {
      get: async (id: string) => id === "child_1" ? run : null,
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  } as unknown as MutationCtx;
  const handler = (finalizeRun as unknown as {
    _handler: (ctx: MutationCtx, args: Record<string, unknown>) => Promise<unknown>;
  })._handler;

  const result = await handler(ctx, {
    runId: "child_1",
    status: "completed",
    content: "late provider response",
  });

  assert.equal(result, null);
  assert.deepEqual(patches, []);
});

test("terminal parent settles a claimed durable subagent batch before waking the checkpoint", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const batch = {
    _id: "batch_1",
    status: "resuming",
    parentJobId: "job_1",
    userId: "user_1",
    paramsSnapshot: { workflowResumeEventId: "event_1" },
  } as unknown as Doc<"subagentBatches">;
  const ctx = {
    runQuery: async (_reference: unknown, args: Record<string, unknown>) => {
      if ("batchId" in args) return [];
      if ("jobId" in args) return { _id: "job_1", status: "completed" };
      return { isPro: true };
    },
    runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      return true;
    },
  };
  assert.equal(await continueDurableParentAfterSubagents(
    ctx as never,
    "batch_1" as never,
    { batch, claimed: true },
  ), true);
  assert.equal(mutations[0]?.status, "completed");
  assert.equal(mutations[0]?.expectedCurrentStatus, "resuming");
  assert.equal(mutations[1]?.eventId, "event_1");
});

test("subagent execution writes require the exact active attempt and fence", async () => {
  const rows: Record<string, unknown> = {
    child_1: {
      _id: "child_1",
      batchId: "batch_1",
      status: "streaming",
    },
    batch_1: { _id: "batch_1", status: "running_children" },
    attempt_1: {
      _id: "attempt_1",
      runId: "execution_1",
      claimantId: "subagent-workflow:child_1",
      fence: 7,
      status: "running",
    },
    execution_1: {
      _id: "execution_1",
      activeAttemptId: "attempt_1",
      state: "running",
    },
  };
  const ctx = {
    db: { get: async (id: string) => rows[id] ?? null },
  } as unknown as QueryCtx;
  const run = rows.child_1 as Doc<"subagentRuns">;

  assert.equal(await isCurrentSubagentExecution(ctx, run, {
    executionAttemptId: "attempt_1" as never,
    executionFence: 7,
  }), true);
  assert.equal(await isCurrentSubagentExecution(ctx, run, {
    executionAttemptId: "attempt_1" as never,
    executionFence: 6,
  }), false);
});

test("an old autonomous epoch cannot create a message after pause and resume", async () => {
  let insertCount = 0;
  const ctx = {
    db: {
      get: async (id: string) => id === "session_1"
        ? { _id: id, status: "running", executionEpoch: 3 }
        : null,
      insert: async () => {
        insertCount += 1;
        return "message_1";
      },
      patch: async () => undefined,
    },
  } as unknown as MutationCtx;

  const result = await createAutonomousMessageHandler(ctx, {
    sessionId: "session_1" as never,
    executionEpoch: 2,
    chatId: "chat_1" as never,
    userId: "user_1",
    modelId: "model_1",
    participantId: "participant_1",
    participantName: "One",
    parentMessageIds: [],
  });

  assert.equal(result, null);
  assert.equal(insertCount, 0);
});

test("research phase writes reject a superseded attempt or fence", async () => {
  const session = {
    _id: "session_1",
    status: "planning",
    executionAttemptId: "attempt_2",
    executionFence: 8,
    executionClaimantId: "research-workflow:session_1",
  } as unknown as Doc<"searchSessions">;
  const rows: Record<string, unknown> = {
    attempt_2: {
      _id: "attempt_2",
      runId: "execution_1",
      claimantId: "research-workflow:session_1",
      fence: 8,
      status: "running",
    },
    execution_1: {
      _id: "execution_1",
      activeAttemptId: "attempt_2",
      state: "running",
    },
  };
  const ctx = {
    db: { get: async (id: string) => rows[id] ?? null },
  } as unknown as QueryCtx;

  assert.equal(await isCurrentResearchExecution(ctx, session, {
    executionAttemptId: "attempt_2" as never,
    executionFence: 8,
  }), true);
  assert.equal(await isCurrentResearchExecution(ctx, session, {
    executionAttemptId: "attempt_1" as never,
    executionFence: 7,
  }), false);
});

test("failed subagent Workflow completion terminalizes and resumes its batch once", async () => {
  const rows = new Map<string, TestRow>([
    ["child_1", {
      _id: "child_1",
      batchId: "batch_1",
      status: "streaming",
      workflowId: "workflow_1",
    }],
    ["batch_1", {
      _id: "batch_1",
      status: "running_children",
      completedChildCount: 0,
      failedChildCount: 0,
    }],
  ]);
  const scheduled: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      get: async (id: string) => rows.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        const row = rows.get(id);
        if (row) rows.set(id, { ...row, ...patch });
      },
      query: () => ({
        withIndex: () => ({
          collect: async () => [rows.get("child_1")],
        }),
      }),
    },
    scheduler: {
      runAfter: async (
        _delay: number,
        _reference: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push(args);
        return `scheduled_${scheduled.length}`;
      },
    },
  } as unknown as MutationCtx;
  const handler = (reconcileSubagentWorkflow as unknown as {
    _handler: (
      context: MutationCtx,
      args: Record<string, unknown>,
    ) => Promise<null>;
  })._handler;
  const args = {
    workflowId: "workflow_1",
    context: { runId: "child_1" },
    result: { kind: "failed", error: "provider unavailable" },
  };

  await handler(ctx, args);
  await handler(ctx, args);

  assert.equal(rows.get("child_1")?.status, "failed");
  assert.equal(rows.get("batch_1")?.status, "waiting_to_resume");
  assert.equal(rows.get("batch_1")?.completedChildCount, 1);
  assert.equal(rows.get("batch_1")?.failedChildCount, 1);
  assert.equal(
    scheduled.filter((scheduledArgs) => scheduledArgs.batchId === "batch_1").length,
    2,
  );
});
