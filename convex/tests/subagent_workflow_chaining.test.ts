import assert from "node:assert/strict";
import test from "node:test";

import type { WorkflowCtx } from "@convex-dev/workflow";
import type { MutationCtx } from "../_generated/server";
import {
  nextSubagentInvocationOffset,
  runSubagentWorkflowHandler,
  SUBAGENT_WORKFLOW_ROUNDS_PER_CHUNK,
} from "../subagents/subagent_workflow";
import { startSubagentSuccessorHandler } from "../subagents/subagent_workflow_handoff";

test("subagent Workflow chains at a journal boundary without terminalizing the child", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const actions: Array<Record<string, unknown>> = [];
  const step = {
    workflowId: "subagent_workflow_1",
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if ("claimantId" in args && "runId" in args) {
        return { runId: "execution_run_1", attemptId: "attempt_1", fence: 9 };
      }
      if ("workflowId" in args && "attemptId" in args && "fence" in args) return true;
      if ("predecessorWorkflowId" in args) return "subagent_workflow_2";
      return null;
    },
    runAction: async (_ref: unknown, args: Record<string, unknown>) => {
      actions.push(args);
      return null;
    },
    runQuery: async () => ({
      _id: "subagent_run_1",
      batchId: "batch_1",
      status: "waiting_continuation",
    }),
    awaitEvent: async () => null,
    runWorkflow: async () => null,
    sleep: async () => undefined,
  } as unknown as WorkflowCtx;

  await runSubagentWorkflowHandler(step, {
    runId: "subagent_run_1" as never,
    executionRunId: "execution_run_1" as never,
    nextInvocationOffset: "999999999999999999999990",
  });

  assert.equal(actions.length, SUBAGENT_WORKFLOW_ROUNDS_PER_CHUNK);
  assert.equal(mutations.filter((entry) => "outcome" in entry).length, 0);
  const handoff = mutations.find((entry) => "predecessorWorkflowId" in entry);
  assert.equal(handoff?.nextInvocationOffset, "1000000000000000000000014");
  assert.equal(handoff?.attemptId, "attempt_1");
  assert.equal(handoff?.fence, 9);
});

test("terminal subagent resumes its parent exactly once and never spawns a successor", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const actions: Array<Record<string, unknown>> = [];
  const step = {
    workflowId: "subagent_workflow_terminal",
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if ("claimantId" in args && "runId" in args) {
        return { runId: "execution_run_1", attemptId: "attempt_1", fence: 9 };
      }
      if ("workflowId" in args && "attemptId" in args && "fence" in args) return true;
      return null;
    },
    runAction: async (_ref: unknown, args: Record<string, unknown>) => {
      actions.push(args);
      return null;
    },
    runQuery: async () => ({
      _id: "subagent_run_1",
      batchId: "batch_1",
      status: "completed",
    }),
    awaitEvent: async () => null,
    runWorkflow: async () => null,
    sleep: async () => undefined,
  } as unknown as WorkflowCtx;

  await runSubagentWorkflowHandler(step, {
    runId: "subagent_run_1" as never,
    executionRunId: "execution_run_1" as never,
  });

  assert.equal(actions.filter((entry) => "runId" in entry).length, 1);
  assert.equal(actions.filter((entry) => "batchId" in entry).length, 1);
  assert.equal(mutations.filter((entry) => entry.outcome === "completed").length, 1);
  assert.equal(mutations.some((entry) => "predecessorWorkflowId" in entry), false);
});

test("subagent handoff loses to cancellation and finds a delayed duplicate by exact role", async () => {
  let started = 0;
  let linked = 0;
  const deps = {
    startWorkflow: async () => {
      started += 1;
      return "subagent_workflow_2";
    },
    linkComponent: async () => {
      linked += 1;
      return null;
    },
  };
  const args = {
    runId: "subagent_run_1" as never,
    executionRunId: "execution_run_1" as never,
    nextInvocationOffset: "24",
    predecessorWorkflowId: "subagent_workflow_1",
    attemptId: "attempt_1" as never,
    fence: 9,
  };
  const rows: Record<string, Record<string, unknown>> = {
    subagent_run_1: {
      _id: "subagent_run_1",
      batchId: "batch_1",
      status: "waiting_continuation",
    },
    batch_1: { _id: "batch_1", status: "cancelled" },
    execution_run_1: {
      _id: "execution_run_1",
      activeAttemptId: "attempt_1",
      state: "running",
    },
    attempt_1: {
      _id: "attempt_1",
      runId: "execution_run_1",
      fence: 9,
      claimantId: "subagent-workflow:subagent_run_1",
      status: "running",
    },
  };
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const queriedIndexes: string[] = [];
  const unrelatedLaterComponents = Array.from({ length: 1_000 }, (_, index) => ({
    role: `later-component-${index}`,
  }));
  const ctx = {
    db: {
      get: async (id: string) => rows[id] ?? null,
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  } as unknown as MutationCtx;
  assert.equal(await startSubagentSuccessorHandler(ctx, args, deps), null);

  rows.batch_1 = { _id: "batch_1", status: "running_children" };
  Object.assign(ctx.db, {
    query: () => ({
      withIndex: (indexName: string) => ({
        unique: async () => {
          queriedIndexes.push(indexName);
          return indexName === "by_run_role"
            ? {
                role: "subagent-workflow-continuation:24",
                operationId: "subagent_workflow_existing",
                runId: "execution_run_1",
                status: "active",
              }
            : {
                _id: "component_predecessor",
                role: "subagent-workflow",
                operationId: "subagent_workflow_1",
                runId: "execution_run_1",
                status: "active",
              };
        },
      }),
    }),
  });
  assert.equal(
    await startSubagentSuccessorHandler(ctx, args, deps),
    "subagent_workflow_existing",
  );
  assert.equal(started, 0);
  assert.equal(linked, 0);
  assert.equal(unrelatedLaterComponents.length, 1_000);
  assert.deepEqual(queriedIndexes.sort(), ["by_operation", "by_run_role"]);
  assert.ok(patches.some((patch) =>
    patch.id === "subagent_run_1"
      && patch.value.workflowId === "subagent_workflow_existing"));
  assert.ok(patches.some((patch) =>
    patch.id === "component_predecessor" && patch.value.status === "completed"));
});

test("subagent invocation offsets remain exact beyond safe integers", () => {
  assert.equal(nextSubagentInvocationOffset("999999999999999999999"), "1000000000000000000000");
  assert.throws(
    () => nextSubagentInvocationOffset("-1"),
    /SUBAGENT_WORKFLOW_INVOCATION_OFFSET_INVALID/,
  );
});
