import assert from "node:assert/strict";
import test from "node:test";

import { continueDurableParentAfterSubagents } from "../subagents/durable_parent_resume";
import { completeDeferredTool } from "../chat/workflow_events";
import { enqueueSubagent } from "../execution/fanout_queues";

function durableBatch(status = "waiting_to_resume") {
  return {
    _id: "batch_1",
    status,
    parentMessageId: "assistant_1",
    sourceUserMessageId: "user_message_1",
    parentJobId: "job_1",
    chatId: "chat_1",
    userId: "user_1",
    toolCallId: "call_subagents",
    toolRoundCalls: [{
      id: "call_subagents",
      function: { name: "spawn_subagents", arguments: "{}" },
    }],
    toolRoundResults: [],
    resumeConversationSeed: [{
      role: "tool",
      tool_call_id: "call_subagents",
      content: "pending",
    }],
    participantSnapshot: {
      participant: {
        modelId: "openai/gpt-5",
        messageId: "assistant_1",
        jobId: "job_1",
      },
    },
    paramsSnapshot: {
      workflowResumeEventId: "event_1",
      executionAttemptId: "attempt_1",
      executionFence: 3,
      enabledIntegrations: ["google_drive"],
      requestParams: { webSearchEnabled: true, provider: { zdr: true } },
    },
  };
}

test("durable subagent join checkpoints once and signals the active parent Workflow", async () => {
  let batch = durableBatch();
  let batchQueryCount = 0;
  let parentJobQueryCount = 0;
  const mutations: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("batchId" in args) {
        batchQueryCount += 1;
        if (batchQueryCount <= 2) return batch;
        return [{
          childIndex: 0,
          title: "Research",
          status: "completed",
          content: "Durable result",
        }];
      }
      if ("jobId" in args) {
        parentJobQueryCount += 1;
        return parentJobQueryCount === 1
          ? { _id: "job_1", status: "streaming", userId: "user_1" }
          : {
              _id: "continuation_1",
              roundKey: "event_1",
              continuationCount: 7,
              compactionCount: 2,
              groupSnapshot: {
                drivePickerBatchId: "drive_batch_earlier",
                searchSessionId: "search_session_1",
              },
            };
      }
      if ("userId" in args) return { isPro: true };
      throw new Error(`Unexpected query ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (Object.keys(args).length === 1 && args.batchId === "batch_1") {
        batch = { ...batch, status: "resuming" };
        return true;
      }
      return null;
    },
    scheduler: {
      runAfter: async () => {
        throw new Error("durable parent join must not use the legacy scheduler");
      },
    },
  } as any;

  assert.equal(await continueDurableParentAfterSubagents(ctx, "batch_1" as any), true);
  const saved = mutations.find((entry) => "checkpoint" in entry) as {
    checkpoint?: {
      messages?: Array<{ content?: string }>;
      group?: Record<string, unknown>;
      continuationCount?: number;
      compactionCount?: number;
    };
  } | undefined;
  assert.ok(saved?.checkpoint);
  assert.match(saved.checkpoint.messages?.[0]?.content ?? "", /Durable result/);
  assert.equal(saved.checkpoint.group?.subagentBatchId, "batch_1");
  assert.equal(saved.checkpoint.group?.executionFence, 3);
  assert.equal(saved.checkpoint.group?.drivePickerBatchId, "drive_batch_earlier");
  assert.equal(saved.checkpoint.group?.searchSessionId, "search_session_1");
  assert.equal(saved.checkpoint.continuationCount, 7);
  assert.equal(saved.checkpoint.compactionCount, 2);
  assert.ok(mutations.some((entry) =>
    entry.eventId === "event_1" && "checkpoint" in entry));
});

test("durable subagent join is harmless after parent cancellation", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  let batchQueryCount = 0;
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("batchId" in args) {
        batchQueryCount += 1;
        return batchQueryCount === 1 ? durableBatch("resuming") : [];
      }
      if ("jobId" in args) return { _id: "job_1", status: "cancelled", userId: "user_1" };
      if ("userId" in args) return { isPro: true };
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      return null;
    },
  } as any;

  assert.equal(await continueDurableParentAfterSubagents(ctx, "batch_1" as any), true);
  assert.equal(mutations.some((entry) => "checkpoint" in entry), false);
  assert.ok(mutations.some((entry) =>
    entry.eventId === "event_1"
      && (entry.value as { mode?: string } | undefined)?.mode === "fresh"));
});

test("deferred tool completion replaces the checkpoint before signaling and deduplicates", async () => {
  const continuation = {
    _id: "continuation_1",
    userId: "user_1",
    requestMessages: [{ role: "tool", tool_call_id: "call_1", content: "pending" }],
    toolResults: [],
    toolCalls: [{ id: "call_1", name: "create_presentation", arguments: "{}" }],
    deferredResumeEventId: "event_1",
    executionAttemptId: "attempt_1",
    executionFence: 3,
  };
  const patches: Array<Record<string, unknown>> = [];
  const eventSends: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      get: async () => ({
        _id: "job_1",
        userId: "user_1",
        status: "streaming",
        executionAttemptId: "attempt_1",
        executionFence: 3,
      }),
      query: () => ({
        withIndex: () => ({ first: async () => continuation }),
      }),
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
        Object.assign(continuation, value);
      },
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      eventSends.push(args);
      return "event_1";
    },
  } as any;
  const args = {
    jobId: "job_1",
    userId: "user_1",
    toolCallId: "call_1",
    toolName: "create_presentation",
    result: "{\"storageId\":\"storage_1\"}",
    eventId: "event_1",
  };

  assert.equal(await (completeDeferredTool as any)._handler(ctx, args), "resumed");
  assert.equal(await (completeDeferredTool as any)._handler(ctx, args), "duplicate");
  assert.equal((patches[0].requestMessages as Array<{ content: string }>)[0]?.content, args.result);
  assert.equal(eventSends.length, 1);
});

test("duplicate subagent dispatch reuses the existing child Workflow", async () => {
  const result = await (enqueueSubagent as any)._handler({
    db: {
      get: async () => ({ workpoolOperationId: "workflow_1" }),
      patch: async () => {
        throw new Error("duplicate dispatch must not patch");
      },
    },
    runMutation: async () => {
      throw new Error("duplicate dispatch must not start another Workflow");
    },
  }, { runId: "run_1" });

  assert.equal(result, "workflow_1");
});
