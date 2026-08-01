import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import {
  markMcpExecutionWaitingForInput,
  resumeMcpExecutionForInvocation,
} from "../mcp/execution_waiting";
import {
  releaseTaskOperation,
  restoreTaskInputWait,
  resumeInvocationOperation,
} from "../mcp/lifecycle_mutations";
import {
  settleDeferredInvocationHandler,
  signalTaskInputHandler,
} from "../mcp/task_lifecycle";
import { settleMcpInvocation } from "../mcp/settlement";

type Rows = Record<string, Array<Record<string, unknown>>>;

function fixture(state: "running" | "waiting" = "running") {
  const rows: Rows = {
    accountDeletionTombstones: [],
    executionRuns: [{
      _id: "run_1",
      userId: "user_1",
      runKey: "remote-mcp:invocation_1",
      kind: "remote_mcp",
      state: state === "waiting" ? "waiting_for_input" : "running",
      requestedPlacement: "cloud",
      activeAttemptId: "attempt_1",
      nextEventSequence: 0,
      createdAt: 1,
      updatedAt: 1,
    }],
    executionAttempts: [{
      _id: "attempt_1",
      runId: "run_1",
      attemptNumber: 1,
      fence: 1,
      status: state,
      claimantId: "remote-mcp:invocation_1",
      executorKind: "convex_workflow",
      placement: "cloud",
      adapterId: "convex-workflow",
      createdAt: 1,
      updatedAt: 1,
    }],
    runEvents: [],
    mcpInvocations: [{
      _id: "invocation_1",
      userId: "user_1",
      publicId: "public_1",
      connectionId: "connection_1",
      kind: "tool",
      method: "tools/call",
      requestHash: "hash_1",
      state: state === "waiting" ? "awaiting_input" : "dispatching",
      activeOperationKey: state === "waiting" ? undefined : "operation_1",
      taskId: "task_1",
      taskResumeEventId: "event_1",
      durableRunId: "run_1",
      durableAttemptId: "attempt_1",
      durableFence: 1,
      executionClaimantId: "remote-mcp:invocation_1",
      createdAt: 1,
      updatedAt: 1,
    }],
  };
  return { rows, ctx: createStatefulMockCtx(rows) as unknown as MutationCtx };
}

const execution = {
  runId: "run_1" as Id<"executionRuns">,
  attemptId: "attempt_1" as Id<"executionAttempts">,
  fence: 1,
  claimantId: "remote-mcp:invocation_1",
};

test("MCP waiting event commits before the attempt becomes non-writable", async () => {
  const { rows, ctx } = fixture();

  await markMcpExecutionWaitingForInput(ctx, execution);

  assert.equal(rows.runEvents.length, 1);
  assert.equal(rows.runEvents[0]?.type, "waiting_for_input");
  assert.equal(rows.executionAttempts[0]?.status, "waiting");
  assert.equal(rows.executionRuns[0]?.state, "waiting_for_input");

  await markMcpExecutionWaitingForInput(ctx, execution);
  assert.equal(rows.runEvents.length, 1);
});

test("a claimed human task operation resumes and safely restores one atomic wait", async () => {
  const { rows, ctx } = fixture("waiting");
  const invocation = rows.mcpInvocations[0];
  assert.ok(invocation);
  invocation.state = "dispatching";
  invocation.activeOperationKey = "operation_1";

  const resume = (resumeInvocationOperation as unknown as {
    _handler: (context: MutationCtx, args: Record<string, unknown>) => Promise<boolean>;
  })._handler;
  assert.equal(await resume(ctx, {
    userId: "user_1",
    invocationId: "invocation_1",
    operationKey: "operation_1",
  }), true);
  assert.equal(rows.executionAttempts[0]?.status, "running");
  assert.equal(rows.executionRuns[0]?.state, "running");

  const release = (releaseTaskOperation as unknown as {
    _handler: (context: MutationCtx, args: Record<string, unknown>) => Promise<boolean>;
  })._handler;
  assert.equal(await release(ctx, {
    userId: "user_1",
    invocationId: "invocation_1",
    operationKey: "operation_1",
    state: "awaiting_input",
  }), true);
  assert.equal(invocation.state, "awaiting_input");
  assert.equal(invocation.activeOperationKey, undefined);
  assert.equal(rows.executionAttempts[0]?.status, "waiting");
  assert.equal(rows.executionRuns[0]?.state, "waiting_for_input");
});

test("task_pending response is persisted before its waiting Workflow is signaled", async () => {
  const { rows, ctx } = fixture("waiting");
  const invocation = rows.mcpInvocations[0];
  assert.ok(invocation);
  invocation.state = "task_pending";
  let delivered = false;

  assert.equal(await signalTaskInputHandler(ctx, {
    invocationId: "invocation_1" as Id<"mcpInvocations">,
    userId: "user_1",
    action: "continue",
  }, async (_context, eventId, action) => {
    assert.equal(eventId, "event_1");
    assert.equal(action, "continue");
    assert.equal(invocation.state, "task_pending");
    assert.equal(invocation.taskResumeEventId, undefined);
    assert.equal(rows.executionAttempts[0]?.status, "running");
    assert.equal(rows.executionRuns[0]?.state, "running");
    delivered = true;
  }), true);
  assert.equal(delivered, true);
});

test("tasks/get input_required restores waiting and retains the Workflow event", async () => {
  const { rows, ctx } = fixture("waiting");
  const invocation = rows.mcpInvocations[0];
  assert.ok(invocation);
  rows.executionAttempts[0]!.status = "running";
  rows.executionRuns[0]!.state = "running";

  const restore = (restoreTaskInputWait as unknown as {
    _handler: (context: MutationCtx, args: Record<string, unknown>) => Promise<boolean>;
  })._handler;
  assert.equal(await restore(ctx, {
    userId: "user_1",
    invocationId: "invocation_1",
  }), true);
  assert.equal(invocation.state, "awaiting_input");
  assert.equal(invocation.taskResumeEventId, "event_1");
  assert.equal(rows.executionAttempts[0]?.status, "waiting");
  assert.equal(rows.executionRuns[0]?.state, "waiting_for_input");
});

test("task input wait restoration cannot regress a cancelled invocation", async () => {
  const { rows, ctx } = fixture("waiting");
  const invocation = rows.mcpInvocations[0];
  assert.ok(invocation);
  invocation.state = "cancelled";
  rows.executionAttempts[0]!.status = "running";
  rows.executionRuns[0]!.state = "running";

  const restore = (restoreTaskInputWait as unknown as {
    _handler: (context: MutationCtx, args: Record<string, unknown>) => Promise<boolean>;
  })._handler;
  assert.equal(await restore(ctx, {
    userId: "user_1",
    invocationId: "invocation_1",
  }), false);
  assert.equal(rows.executionAttempts[0]?.status, "running");
  assert.equal(rows.executionRuns[0]?.state, "running");
});

test("terminal task settlement wakes its Workflow event before terminalizing execution", async () => {
  const { rows, ctx } = fixture("waiting");
  const invocation = rows.mcpInvocations[0];
  assert.ok(invocation);
  invocation.state = "outcome_unknown";
  rows.executionAttempts[0]!.status = "running";
  rows.executionRuns[0]!.state = "running";
  let delivered = false;

  await settleDeferredInvocationHandler(ctx, {
    invocationId: "invocation_1" as Id<"mcpInvocations">,
    execution,
  }, async (_context, eventId, action) => {
    assert.equal(eventId, "event_1");
    assert.equal(action, "cancel");
    delivered = true;
  });

  assert.equal(delivered, true);
  assert.equal(invocation.taskResumeEventId, undefined);
  assert.equal(rows.executionAttempts[0]?.status, "failed");
  assert.equal(rows.executionRuns[0]?.state, "failed");
});

test("terminal settlement queues reconciliation before its immediate attempt", async () => {
  const calls: string[] = [];
  const ctx = {
    runMutation: async (reference: Parameters<ActionCtx["runMutation"]>[0]) => {
      calls.push(getFunctionName(reference));
      return null;
    },
  } as Pick<ActionCtx, "runMutation">;

  await settleMcpInvocation(ctx, {
    _id: "invocation_1" as Id<"mcpInvocations">,
    durableRunId: "run_1" as Id<"executionRuns">,
    durableAttemptId: "attempt_1" as Id<"executionAttempts">,
    durableFence: 1,
    executionClaimantId: "remote-mcp:invocation_1",
  });

  assert.deepEqual(calls, [
    "mcp/task_lifecycle:scheduleDeferredInvocationSettlement",
    "mcp/task_lifecycle:settleDeferredInvocation",
  ]);
});

test("task input signaling cannot regress a terminal invocation", async () => {
  const { rows, ctx } = fixture("waiting");
  const invocation = rows.mcpInvocations[0];
  assert.ok(invocation);
  invocation.state = "completed";
  let delivered = false;

  assert.equal(await signalTaskInputHandler(ctx, {
    invocationId: "invocation_1" as Id<"mcpInvocations">,
    userId: "user_1",
    action: "cancel",
  }, async () => {
    delivered = true;
  }), false);
  assert.equal(invocation.state, "completed");
  assert.equal(delivered, false);
});

test("fenced MCP execution resume refuses an invocation without durable ownership", async () => {
  const { ctx } = fixture();
  assert.equal(await resumeMcpExecutionForInvocation(ctx, {
    _id: "invocation_2" as Id<"mcpInvocations">,
    userId: "user_1",
  }), false);
});
