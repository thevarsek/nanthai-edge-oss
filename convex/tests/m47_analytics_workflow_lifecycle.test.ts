import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { resumeParent } from "../analytics_workflows/actions";
import { prepareArtifactIntent } from "../analytics_workflows/artifacts";
import { rebindParentEvent } from "../analytics_workflows/mutations";
import {
  createRuntimeAnalyticsDepsForTest,
  runDataPythonExec,
} from "../runtime/service_analytics";
import { createMockCtx, createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";

test("execution can checkpoint its raw envelope before any artifact attachment", async () => {
  let artifactWrites = 0;
  let stagedCharts = 0;
  const deps = createRuntimeAnalyticsDepsForTest({
    runPyodideCode: async () => ({
      stdout: ["done"],
      stderr: [],
      charts: [{ pngBytes: new Uint8Array([1, 2, 3]), index: 0 }],
      outputFiles: [],
      error: null,
      errorType: null,
      canRetryWithSandbox: false,
      returnValue: null,
      memoryRssMiB: { baseline: 1, afterLoad: 2, afterPackages: 3, afterExecution: 4 },
    }),
    storeArtifactBytes: async () => {
      artifactWrites += 1;
      throw new Error("artifact persistence must happen in collect");
    },
  });
  await runDataPythonExec(
    { userId: "user_1", chatId: "chat_1", ctx: createMockCtx({}) } as never,
    {
      code: "print('done')",
      onExecutionReady: async (envelope) => {
        stagedCharts = envelope.charts.length;
      },
    },
    deps,
  );
  assert.equal(stagedCharts, 1);
  assert.equal(artifactWrites, 0);
});

test("artifact intent replay is idempotent and rejects a different claimant", async () => {
  const now = Date.now();
  const rows: Record<string, Array<Record<string, unknown>>> = {
    executionRuns: [{
      _id: "execution_1",
      userId: "user_1",
      kind: "analytics",
      state: "running",
      requestedPlacement: "cloud",
      activeAttemptId: "attempt_1",
      nextAttemptNumber: 2,
      nextFence: 2,
      nextEventSequence: 1,
      createdAt: now,
      updatedAt: now,
    }],
    executionAttempts: [{
      _id: "attempt_1",
      runId: "execution_1",
      userId: "user_1",
      attemptNumber: 1,
      executorKind: "convex_workflow",
      placement: "cloud",
      adapterId: "convex-workflow",
      protocolVersion: "nanthai-execution-v1",
      status: "running",
      claimantId: "analytics-workflow:run_1",
      fence: 1,
      leaseExpiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    }],
    analyticsWorkflowRuns: [{
      _id: "run_1",
      userId: "user_1",
      status: "running",
      artifactKey: "job_1:call_1",
      executionRunId: "execution_1",
      executionAttemptId: "attempt_1",
      executionFence: 1,
    }],
    analyticsArtifactIntents: [],
    runEvents: [],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  const args = {
    analyticsRunId: "run_1" as Id<"analyticsWorkflowRuns">,
    claimantId: "analytics-workflow:run_1",
    ordinal: 0,
    kind: "chart" as const,
    filename: "chart-1.png",
    mimeType: "image/png",
    sizeBytes: 3,
  };
  const first = await prepareArtifactIntent(ctx, args);
  const replay = await prepareArtifactIntent(ctx, args);
  assert.equal(replay.intentId, first.intentId);
  assert.equal(rows.analyticsArtifactIntents.length, 1);
  await assert.rejects(
    prepareArtifactIntent(ctx, { ...args, claimantId: "stale-worker" }),
    /EXECUTION_CLAIMANT_MISMATCH/,
  );
});

test("analytics parent resume never treats a missing checkpoint as delivered", async () => {
  const run = {
    _id: "run_1",
    userId: "user_1",
    jobId: "job_1",
    toolCallId: "call_1",
    toolName: "data_python_exec",
    parentEventId: "event_1",
    status: "running",
    phase: "resume",
    resultJson: "{\"ok\":true}",
  };
  const ctx = createMockCtx({
    runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
      if ("phase" in args) return null;
      return "missing";
    },
    runQuery: async () => run,
  });
  await assert.rejects(
    (resumeParent as unknown as {
      _handler: (context: unknown, args: unknown) => Promise<null>;
    })._handler(ctx, {
      analyticsRunId: "run_1",
      claimantId: "analytics-workflow:run_1",
    }),
    /ANALYTICS_PARENT_CHECKPOINT_NOT_FOUND/,
  );
});

test("analytics parent resume never reloads a stored result blob into a mutation", async () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  const run = {
    _id: "run_1",
    userId: "user_1",
    jobId: "job_1",
    toolCallId: "call_1",
    toolName: "data_python_exec",
    parentEventId: "event_1",
    status: "running",
    phase: "resume",
    resultStorageId: "large_result_blob",
  };
  let queryCount = 0;
  const ctx = {
    runQuery: async () => {
      queryCount += 1;
      return queryCount === 1 ? run : [{ storageId: "artifact_1" }];
    },
    runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      return "duplicate";
    },
    storage: {
      get: async () => assert.fail("resume must not load a stored result blob"),
    },
  };
  await (resumeParent as unknown as {
    _handler: (context: unknown, args: unknown) => Promise<null>;
  })._handler(ctx, {
    analyticsRunId: "run_1",
    claimantId: "analytics-workflow:run_1",
  });
  const resume = mutationCalls.find((call) => call.eventId === "event_1");
  assert.match(String(resume?.result), /large_result_blob/);
});

test("analytics parent-event rebinding rejects a stale recovery", async () => {
  const run = {
    _id: "run_1",
    userId: "user_1",
    jobId: "job_1",
    toolCallId: "call_1",
    parentEventId: "event_old",
  };
  const handler = (rebindParentEvent as unknown as {
    _handler: (context: unknown, args: Record<string, unknown>) => Promise<boolean>;
  })._handler;
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({ unique: async () => run }),
      }),
      patch: async (_id: string, value: Record<string, unknown>) => {
        Object.assign(run, value);
      },
    },
  };
  const base = {
    jobId: "job_1",
    userId: "user_1",
    toolCallId: "call_1",
    nextEventId: "event_new",
  };
  assert.equal(await handler(ctx, { ...base, expectedEventId: "event_stale" }), false);
  assert.equal(run.parentEventId, "event_old");
  assert.equal(await handler(ctx, { ...base, expectedEventId: "event_old" }), true);
  assert.equal(run.parentEventId, "event_new");
});
