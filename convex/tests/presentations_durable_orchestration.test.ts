import assert from "node:assert/strict";
import test from "node:test";
import {
  startPresentationWorkflow,
  startPresentationWorkflowHandler,
} from "../presentations/presentation_workflow_start";
import { rebindPresentationParentEvent } from "../presentations/parent_handoff";
import { renewPresentationExecutionLease } from "../presentations/generation_fanout_start";
import { recoverPresentationWorkflowHandler } from "../presentations/presentation_workflow_recovery";
import { claimPresentationStudioBatchHandler } from "../presentations/generation_studio_mutation_handlers";

test("presentation start accepts deferred args and creates execution identity internally", () => {
  const registered = startPresentationWorkflow as unknown as {
    exportArgs: () => string;
  };
  const args = JSON.parse(registered.exportArgs()) as {
    value: Record<string, unknown>;
  };
  assert.equal("executionAttemptId" in args.value, false);
  assert.equal("executionFence" in args.value, false);
  assert.equal("projectId" in args.value, true);
});

test("presentation Workflow start is idempotent for one project", async () => {
  const project = {
    _id: "project_1",
    userId: "user_1",
    status: "draft",
    workflowId: undefined as string | undefined,
  };
  const ctx = {
    db: {
      get: async () => project,
      patch: async (_id: string, value: Record<string, unknown>) => Object.assign(project, value),
    },
  } as never;
  let starts = 0;
  const start = async () => {
    starts += 1;
    return "workflow_1";
  };
  const args = {
    projectId: "project_1",
    userId: "user_1",
    jobId: "job_1",
    toolCallId: "call_1",
    modelId: "openai/gpt-5",
    workflowResumeEventId: "event_1",
  } as never;

  const createExecution = async () => ({
    runId: "execution_1",
    attemptId: "attempt_1",
    fence: 1,
  });
  const link = async () => undefined;
  const claim = async (_ctx: unknown, execution: unknown) => execution;
  assert.equal(await startPresentationWorkflowHandler(
    ctx, args, start as never, createExecution as never, link as never, claim as never,
  ), "workflow_1");
  assert.equal((project as { parentResumeEventId?: string }).parentResumeEventId, "event_1");
  assert.equal(await startPresentationWorkflowHandler(
    ctx, args, start as never, createExecution as never, link as never, claim as never,
  ), "workflow_1");
  assert.equal(starts, 1);
});

test("presentation Workflow start rejects a foreign project", async () => {
  const ctx = {
    db: {
      get: async () => ({ _id: "project_1", userId: "user_2", status: "draft" }),
      patch: async () => assert.fail("foreign projects must not be patched"),
    },
  } as never;
  await assert.rejects(() => startPresentationWorkflowHandler(ctx, {
    projectId: "project_1",
    userId: "user_1",
    jobId: "job_1",
    toolCallId: "call_1",
    modelId: "openai/gpt-5",
  } as never, (async () => "workflow_1") as never, (async () => ({
    runId: "execution_1", attemptId: "attempt_1", fence: 1,
  })) as never, (async () => undefined) as never, (async (_ctx: unknown, execution: unknown) => execution) as never), /unauthorized/);
});

test("presentation parent-event rebinding is an exact compare-and-swap", async () => {
  const project = {
    _id: "project_1",
    userId: "user_1",
    originAssistantMessageId: "message_1",
    originToolCallId: "call_1",
    parentResumeEventId: "event_old",
  };
  const ctx = {
    db: {
      get: async () => ({ _id: "job_1", userId: "user_1", messageId: "message_1" }),
      query: () => ({
        withIndex: () => ({ collect: async () => [project] }),
      }),
      patch: async (_id: string, value: Record<string, unknown>) => {
        Object.assign(project, value);
      },
    },
  };
  const handler = (rebindPresentationParentEvent as unknown as {
    _handler: (context: unknown, args: Record<string, unknown>) => Promise<boolean>;
  })._handler;
  const base = {
    jobId: "job_1",
    userId: "user_1",
    toolCallId: "call_1",
    nextEventId: "event_new",
  };
  assert.equal(await handler(ctx, { ...base, expectedEventId: "event_stale" }), false);
  assert.equal(project.parentResumeEventId, "event_old");
  assert.equal(await handler(ctx, { ...base, expectedEventId: "event_old" }), true);
  assert.equal(project.parentResumeEventId, "event_new");
});

test("expired presentation lease schedules replacement without superseding its frozen fence", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  const patches: Array<Record<string, unknown>> = [];
  const rows: Record<string, Record<string, unknown>> = {
    run_1: {
      _id: "run_1", projectId: "project_1", userId: "user_1",
      executionRunId: "execution_1", executionAttemptId: "attempt_1", executionFence: 4,
    },
    project_1: { _id: "project_1", userId: "user_1", status: "generating", revision: 3 },
    execution_1: { _id: "execution_1", activeAttemptId: "attempt_1" },
    attempt_1: {
      _id: "attempt_1", fence: 4, status: "running",
      claimantId: "presentation:project_1", leaseExpiresAt: Date.now() - 1,
    },
  };
  const ctx = {
    db: {
      get: async (id: string) => rows[id] ?? null,
      patch: async (_id: string, value: Record<string, unknown>) => patches.push(value),
    },
    scheduler: {
      runAfter: async (_delay: number, _reference: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "scheduled_1";
      },
    },
  };
  await assert.rejects(
    renewPresentationExecutionLease(ctx as never, "run_1" as never, {
      executionAttemptId: "attempt_1" as never,
      executionFence: 4,
    }),
    /replacement Workflow/,
  );
  assert.deepEqual(scheduled, [{
    runId: "run_1", expectedAttemptId: "attempt_1", expectedFence: 4,
  }]);
  assert.deepEqual(patches, []);
});

test("presentation replacement Workflow is rebound to its new attempt and fence", async () => {
  const project = {
    _id: "project_1", userId: "user_1", status: "generating",
    workflowId: "workflow_old", parentResumeEventId: "event_1",
  };
  const run = {
    _id: "run_1", projectId: "project_1", userId: "user_1", status: "generating",
    executionRunId: "execution_1", executionAttemptId: "attempt_1", executionFence: 4,
    workflowId: "workflow_old", jobId: "job_1", toolCallId: "call_1",
    selectedModelId: "openai/gpt-5",
  };
  const ctx = {
    db: {
      get: async (id: string) => id === "run_1" ? run : project,
      patch: async (id: string, value: Record<string, unknown>) => {
        Object.assign(id === "run_1" ? run : project, value);
      },
    },
  };
  const cancelled: string[] = [];
  const workflowArgs: Array<Record<string, unknown>> = [];
  const result = await recoverPresentationWorkflowHandler(ctx as never, {
    runId: "run_1" as never,
    expectedAttemptId: "attempt_1" as never,
    expectedFence: 4,
  }, {
    claim: async () => ({
      runId: "execution_1" as never,
      attemptId: "attempt_2" as never,
      fence: 5,
      leaseExpiresAt: Date.now() + 60_000,
    }),
    start: async (_context, args) => {
      workflowArgs.push(args);
      return "workflow_new";
    },
    link: async () => "component_1" as never,
    cancel: async (_context, workflowId) => { cancelled.push(workflowId); },
  });
  assert.equal(result, "workflow_new");
  assert.equal(workflowArgs[0]?.executionAttemptId, "attempt_2");
  assert.equal(workflowArgs[0]?.executionFence, 5);
  assert.equal(run.executionAttemptId, "attempt_2");
  assert.equal(project.workflowId, "workflow_new");
  assert.deepEqual(cancelled, ["workflow_old"]);
});

test("a queued presentation worker cannot adopt a recovered execution fence", async () => {
  const rows: Record<string, Record<string, unknown>> = {
    run_1: {
      _id: "run_1", status: "generating", projectId: "project_1", jobId: "job_1",
      executionAttemptId: "attempt_2", executionFence: 5,
    },
    batch_1: { _id: "batch_1", runId: "run_1", status: "queued" },
  };
  const ctx = {
    db: { get: async (id: string) => rows[id] ?? null },
  };
  assert.equal(await claimPresentationStudioBatchHandler(ctx as never, {
    runId: "run_1" as never,
    batchId: "batch_1" as never,
    repair: false,
    executionAttemptId: "attempt_1" as never,
    executionFence: 4,
  }), false);
});
