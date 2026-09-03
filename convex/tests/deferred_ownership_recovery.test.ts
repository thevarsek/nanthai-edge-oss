import assert from "node:assert/strict";
import test from "node:test";

import { scheduleDeferredAnalyticsWorkflow } from "../analytics_workflows/parent_handoff";
import { reconcileGenerationDeferredOwnership } from "../chat/generation_deferred_ownership";
import { rebindDeferredResumeHandler } from "../chat/workflow_recovery";

function deferredCtx(initial: Array<Record<string, unknown>>) {
  const docs = new Map(initial.map((doc) => [String(doc._id), doc]));
  return {
    docs,
    ctx: {
      db: {
        get: async (id: string) => docs.get(id) ?? null,
        patch: async (id: string, value: Record<string, unknown>) => {
          const doc = docs.get(id);
          if (!doc) throw new Error(`Missing doc: ${id}`);
          Object.assign(doc, value);
        },
        query: (table: string) => ({
          withIndex: () => ({
            collect: async () => table === "subagentRuns"
              ? [...docs.values()].filter((doc) => doc.batchId === "batch_1")
              : [],
          }),
        }),
      },
    },
  };
}

const unusedDeps = {
  enqueueSubagent: async () => "unused",
  startPresentation: async () => "unused",
  startAnalytics: async () => "unused",
  startVideo: async () => "unused",
};

test("subagent recovery enqueues only missing children after a partial enqueue", async () => {
  const state = deferredCtx([
    {
      _id: "batch_1",
      parentJobId: "job_1",
      userId: "user_1",
      workflowResumeEventId: "old_event",
      paramsSnapshot: { workflowResumeEventId: "old_event" },
    },
    { _id: "run_missing", batchId: "batch_1", status: "queued" },
    {
      _id: "run_started",
      batchId: "batch_1",
      status: "queued",
      workpoolOperationId: "work_1",
    },
    { _id: "run_completed", batchId: "batch_1", status: "completed" },
  ]);
  const enqueued: string[] = [];
  const deps = {
    ...unusedDeps,
    enqueueSubagent: async (_ctx: unknown, args: { runId: string }) => {
      enqueued.push(args.runId);
      Object.assign(state.docs.get(args.runId) ?? {}, { workpoolOperationId: `work:${args.runId}` });
      return `work:${args.runId}`;
    },
  };
  const args = {
    ownership: { kind: "subagents" as const, batchId: "batch_1" },
    eventId: "next_event",
    jobId: "job_1",
    userId: "user_1",
    executionAttemptId: "attempt_2",
    executionFence: 8,
  };

  await reconcileGenerationDeferredOwnership(state.ctx as never, args as never, deps as never);
  await reconcileGenerationDeferredOwnership(state.ctx as never, args as never, deps as never);

  assert.deepEqual(enqueued, ["run_missing"]);
  const batch = state.docs.get("batch_1");
  assert.equal(batch?.workflowResumeEventId, "next_event");
  assert.equal(
    (batch?.paramsSnapshot as { executionAttemptId?: string }).executionAttemptId,
    "attempt_2",
  );
});

test("presentation recovery starts a missing owner once and only rebinds an existing owner", async () => {
  const state = deferredCtx([{
    _id: "project_1",
    userId: "user_1",
    parentResumeEventId: "old_event",
  }]);
  let starts = 0;
  const deps = {
    ...unusedDeps,
    startPresentation: async (_ctx: unknown, args: { workflowResumeEventId?: string }) => {
      starts += 1;
      Object.assign(state.docs.get("project_1") ?? {}, {
        workflowId: "presentation_workflow_1",
        parentResumeEventId: args.workflowResumeEventId,
      });
      return "presentation_workflow_1";
    },
  };
  const args = {
    ownership: {
      kind: "presentation" as const,
      projectId: "project_1",
      toolCallId: "tool_1",
      modelId: "openai/gpt-5",
    },
    eventId: "next_event",
    jobId: "job_1",
    userId: "user_1",
  };

  await reconcileGenerationDeferredOwnership(state.ctx as never, args as never, deps as never);
  await reconcileGenerationDeferredOwnership(
    state.ctx as never,
    { ...args, eventId: "latest_event" } as never,
    deps as never,
  );

  assert.equal(starts, 1);
  assert.equal(state.docs.get("project_1")?.parentResumeEventId, "latest_event");
});

test("video recovery reuses its owned job and rebinds the replacement event", async () => {
  const state = deferredCtx([{
    _id: "video_1",
    userId: "user_1",
    generationJobId: "job_1",
    toolCallId: "tool_1",
  }]);
  let starts = 0;
  const deps = {
    ...unusedDeps,
    startVideo: async (_ctx: unknown, args: { workflowResumeEventId: string }) => {
      starts += 1;
      Object.assign(state.docs.get("video_1") ?? {}, {
        workflowId: "video_workflow_1",
        parentResumeEventId: args.workflowResumeEventId,
      });
      return "video_workflow_1";
    },
  };
  const args = {
    ownership: { kind: "video" as const, videoJobId: "video_1", toolCallId: "tool_1" },
    eventId: "next_event",
    jobId: "job_1",
    userId: "user_1",
  };

  await reconcileGenerationDeferredOwnership(state.ctx as never, args as never, deps as never);
  await reconcileGenerationDeferredOwnership(
    state.ctx as never,
    { ...args, eventId: "latest_event" } as never,
    deps as never,
  );

  assert.equal(starts, 2);
  assert.equal(state.docs.get("video_1")?.parentResumeEventId, "latest_event");
});

test("analytics recovery starts a prepared owner once and only rebinds an existing owner", async () => {
  const state = deferredCtx([{
    _id: "analytics_1",
    jobId: "job_1",
    userId: "user_1",
    status: "prepared",
  }]);
  let starts = 0;
  const deps = {
    ...unusedDeps,
    startAnalytics: async (_ctx: unknown, args: { eventId: string }) => {
      starts += 1;
      Object.assign(state.docs.get("analytics_1") ?? {}, {
        workflowId: "analytics_workflow_1",
        parentEventId: args.eventId,
        status: "running",
      });
      return "analytics_workflow_1";
    },
  };
  const args = {
    ownership: { kind: "analytics" as const, analyticsRunId: "analytics_1" },
    eventId: "next_event",
    jobId: "job_1",
    userId: "user_1",
  };

  await reconcileGenerationDeferredOwnership(state.ctx as never, args as never, deps as never);
  await reconcileGenerationDeferredOwnership(
    state.ctx as never,
    { ...args, eventId: "latest_event" } as never,
    deps as never,
  );

  assert.equal(starts, 1);
  assert.equal(state.docs.get("analytics_1")?.parentEventId, "latest_event");
});

test("Drive picker recovery rebinds the durable batch to the replacement event", async () => {
  const state = deferredCtx([{
    _id: "drive_batch_1",
    parentJobId: "job_1",
    userId: "user_1",
    workflowResumeEventId: "old_event",
    paramsSnapshot: { workflowResumeEventId: "old_event" },
    status: "awaiting_pick",
  }]);

  await reconcileGenerationDeferredOwnership(state.ctx as never, {
    ownership: { kind: "drive_picker", batchId: "drive_batch_1" },
    eventId: "next_event",
    jobId: "job_1",
    userId: "user_1",
    executionAttemptId: "attempt_2",
    executionFence: 8,
  } as never, unusedDeps as never);

  const batch = state.docs.get("drive_batch_1");
  assert.equal(batch?.workflowResumeEventId, "next_event");
  assert.deepEqual(batch?.paramsSnapshot, {
    workflowResumeEventId: "next_event",
    executionAttemptId: "attempt_2",
    executionFence: 8,
  });
});

test("Drive picker recovery signals a resuming batch after rebinding its event", async () => {
  const state = deferredCtx([
    { _id: "job_1", userId: "user_1", status: "streaming" },
    {
      _id: "continuation_1",
      jobId: "job_1",
      deferredResumeEventId: "old_event",
      deferredOwnership: { kind: "drive_picker", batchId: "drive_batch_1" },
    },
    {
      _id: "drive_batch_1",
      parentJobId: "job_1",
      userId: "user_1",
      workflowResumeEventId: "old_event",
      paramsSnapshot: { workflowResumeEventId: "old_event" },
      status: "resuming",
    },
  ]);
  const sent: Array<{ eventId: string; batchId: string }> = [];
  const query = (table: string) => ({
    withIndex: () => ({
      first: async () => table === "generationContinuations"
        ? state.docs.get("continuation_1")
        : null,
      unique: async () => null,
      collect: async () => table === "drivePickerBatches"
        ? [state.docs.get("drive_batch_1")]
        : [],
    }),
  });
  (state.ctx.db as unknown as { query: typeof query }).query = query;

  assert.equal(await rebindDeferredResumeHandler(state.ctx as never, {
    jobId: "job_1",
    userId: "user_1",
    oldEventId: "old_event",
    newEventId: "new_event",
  } as never, {
    sendResumeEvent: async (_ctx, eventId, batchId) => {
      sent.push({ eventId, batchId: String(batchId) });
    },
  }), true);

  assert.deepEqual(sent, [{ eventId: "new_event", batchId: "drive_batch_1" }]);
  assert.equal(state.docs.get("drive_batch_1")?.workflowResumeEventId, "new_event");
});

test("analytics handoff persists ownership before attempting to start its Workflow", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const ctx = {
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      calls.push(args);
      return "workflow_1";
    },
  };
  await scheduleDeferredAnalyticsWorkflow(ctx as never, {
    chatId: "chat_1",
    userMessageId: "user_message_1",
    assistantMessageIds: ["message_1"],
    generationJobIds: ["job_1"],
    participant: { jobId: "job_1", messageId: "message_1", modelId: "model_1" },
    userId: "user_1",
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    effectiveIntegrations: [],
    isPro: true,
    allowSubagents: false,
    workflowManaged: true,
    workflowResumeEventId: "event_1",
    executionAttemptId: "attempt_1",
    executionFence: 7,
  } as never, {
    participant: {},
    group: {},
    messages: [],
    toolCalls: [],
    toolResults: [],
    activeProfiles: [],
    loadedSkills: [],
    compactionCount: 0,
    continuationCount: 1,
  } as never, "analytics_1" as never);

  const checkpoint = calls[0]?.checkpoint as Record<string, unknown>;
  assert.deepEqual(checkpoint.deferredOwnership, {
    kind: "analytics",
    analyticsRunId: "analytics_1",
  });
  assert.deepEqual(calls[1], { analyticsRunId: "analytics_1", eventId: "event_1" });
});
