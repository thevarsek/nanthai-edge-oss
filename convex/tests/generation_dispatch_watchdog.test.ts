import assert from "node:assert/strict";
import test from "node:test";

import { reconcileGenerationDispatchWatchdogHandler } from
  "../chat/generation_dispatch_workflow";
import { reconcileGenerationDispatchHandler } from
  "../chat/generation_dispatch_workflow";

const args = {
  workflowId: "dispatch_workflow_1",
  generationArgs: {
    chatId: "chat_1",
    userMessageId: "user_message_1",
    assistantMessageIds: ["assistant_1"],
    generationJobIds: ["job_1"],
    participants: [{
      modelId: "openai/gpt-5",
      messageId: "assistant_1",
      jobId: "job_1",
    }],
    userId: "user_1",
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    effectiveIntegrations: [],
    isPro: true,
    allowSubagents: false,
  },
};

test("dispatch watchdog reschedules a transient status-read failure", async () => {
  let reconciled = 0;
  let scheduled = 0;
  const result = await reconcileGenerationDispatchWatchdogHandler(
    {} as never,
    args as never,
    {
      hasStrandedParticipants: async () => true,
      restartDispatch: async () => "replacement_dispatch",
      statusWorkflow: async () => {
        throw new Error("component unavailable");
      },
      reconcileCompletion: async () => {
        reconciled += 1;
        return null;
      },
      scheduleWatchdog: async () => {
        scheduled += 1;
      },
      scheduleCleanup: async () => undefined,
    },
  );
  assert.equal(result, "rescheduled");
  assert.equal(reconciled, 0);
  assert.equal(scheduled, 1);
});

test("dispatch watchdog reschedules a transient reconciliation failure", async () => {
  let scheduled = 0;
  const result = await reconcileGenerationDispatchWatchdogHandler(
    {} as never,
    args as never,
    {
      hasStrandedParticipants: async () => true,
      restartDispatch: async () => "replacement_dispatch",
      statusWorkflow: async () => ({ type: "completed", result: null }),
      reconcileCompletion: async () => {
        throw new Error("transaction conflict");
      },
      scheduleWatchdog: async () => {
        scheduled += 1;
      },
      scheduleCleanup: async () => undefined,
    },
  );
  assert.equal(result, "rescheduled");
  assert.equal(scheduled, 1);
});

test("dispatch watchdog settles and cleans a terminal non-stranded workflow", async () => {
  let reconciled = 0;
  let scheduled = 0;
  let cleanupScheduled = 0;
  const result = await reconcileGenerationDispatchWatchdogHandler(
    {} as never,
    args as never,
    {
      hasStrandedParticipants: async () => false,
      restartDispatch: async () => "replacement_dispatch",
      statusWorkflow: async () => ({ type: "completed", result: null }),
      reconcileCompletion: async () => {
        reconciled += 1;
        return null;
      },
      scheduleWatchdog: async () => {
        scheduled += 1;
      },
      scheduleCleanup: async () => {
        cleanupScheduled += 1;
      },
    },
  );
  assert.equal(result, "settled");
  assert.equal(reconciled, 0);
  assert.equal(scheduled, 0);
  assert.equal(cleanupScheduled, 1);
});

test("dispatch watchdog settles cleaned terminal workflows without an immortal poll", async () => {
  let cleanupScheduled = 0;
  let watchdogScheduled = 0;
  const result = await reconcileGenerationDispatchWatchdogHandler(
    {} as never,
    args as never,
    {
      hasStrandedParticipants: async () => false,
      restartDispatch: async () => "replacement_dispatch",
      statusWorkflow: async () => {
        throw new Error("workflow already cleaned");
      },
      reconcileCompletion: async () => null,
      scheduleWatchdog: async () => {
        watchdogScheduled += 1;
      },
      scheduleCleanup: async () => {
        cleanupScheduled += 1;
      },
    },
  );
  assert.equal(result, "settled");
  assert.equal(cleanupScheduled, 1);
  assert.equal(watchdogScheduled, 0);
});

test("dispatch completion propagates participant finalization failures", async () => {
  const ctx = {
    scheduler: { runAfter: async () => "scheduled_1" },
    db: {
      get: async () => ({
        _id: "job_1",
        status: "streaming",
        executionRunId: undefined,
      }),
    },
  };
  await assert.rejects(
    () => reconcileGenerationDispatchHandler(ctx as never, {
      workflowId: "dispatch_workflow_1",
      result: { kind: "failed", error: "dispatch failed" },
      context: { generationArgs: args.generationArgs as never },
    }, {
      finalizeGeneration: async () => {
        throw new Error("transient finalize failure");
      },
    }),
    /transient finalize failure/,
  );
});
