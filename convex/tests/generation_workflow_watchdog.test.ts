import assert from "node:assert/strict";
import test from "node:test";

import { reconcileGenerationWorkflowWatchdogHandler } from "../chat/generation_workflow_watchdog";

function watchdogArgs() {
  return {
    workflowId: "workflow_1",
    participantArgs: {
      chatId: "chat_1",
      userMessageId: "user_message_1",
      assistantMessageIds: ["assistant_1"],
      generationJobIds: ["job_1"],
      participant: {
        modelId: "openai/gpt-5",
        messageId: "assistant_1",
        jobId: "job_1",
      },
      userId: "user_1",
      expandMultiModelGroups: false,
      webSearchEnabled: false,
      effectiveIntegrations: [],
      isPro: true,
      allowSubagents: false,
    },
  };
}

function watchdogCtx(componentStatus: "active" | "failed" = "active") {
  return {
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => ({
            _id: "component_1",
            status: componentStatus,
            operationId: "workflow_1",
          }),
        }),
      }),
    },
    scheduler: { runAfter: async () => "scheduled_1" },
  };
}

test("watchdog replays a terminal Workflow completion when onComplete was lost", async () => {
  const reconciled: Array<Record<string, unknown>> = [];
  const result = await reconcileGenerationWorkflowWatchdogHandler(
    watchdogCtx() as never,
    watchdogArgs() as never,
    {
      statusWorkflow: async () => ({ type: "failed", error: "action failed" }),
      reconcileCompletion: async (_ctx, args) => {
        reconciled.push(args as unknown as Record<string, unknown>);
        return null;
      },
      scheduleWatchdog: async () => undefined,
    },
  );
  assert.equal(result, "reconciled");
  assert.equal(reconciled.length, 1);
  assert.deepEqual(reconciled[0]?.result, { kind: "failed", error: "action failed" });
});

test("watchdog backs off while a Workflow is legitimately waiting", async () => {
  const delays: number[] = [];
  const result = await reconcileGenerationWorkflowWatchdogHandler(
    watchdogCtx() as never,
    watchdogArgs() as never,
    {
      statusWorkflow: async () => ({ type: "inProgress" }),
      reconcileCompletion: async () => {
        throw new Error("in-progress Workflow must not reconcile");
      },
      scheduleWatchdog: async (_ctx, _args, delayMs) => {
        if (delayMs !== undefined) delays.push(delayMs);
      },
    },
  );
  assert.equal(result, "rescheduled");
  assert.deepEqual(delays, [30 * 60 * 1_000]);
});

test("watchdog is idempotent after completion reconciliation settled", async () => {
  let statusReads = 0;
  const result = await reconcileGenerationWorkflowWatchdogHandler(
    watchdogCtx("failed") as never,
    watchdogArgs() as never,
    {
      statusWorkflow: async () => {
        statusReads += 1;
        return { type: "failed", error: "must not read" };
      },
      reconcileCompletion: async () => null,
      scheduleWatchdog: async () => undefined,
    },
  );
  assert.equal(result, "settled");
  assert.equal(statusReads, 0);
});

test("watchdog reschedules instead of terminalizing on a transient status failure", async () => {
  let reconciled = 0;
  let scheduled = 0;
  const result = await reconcileGenerationWorkflowWatchdogHandler(
    watchdogCtx() as never,
    watchdogArgs() as never,
    {
      statusWorkflow: async () => {
        throw new Error("component temporarily unavailable");
      },
      reconcileCompletion: async () => {
        reconciled += 1;
        return null;
      },
      scheduleWatchdog: async () => {
        scheduled += 1;
      },
    },
  );
  assert.equal(result, "rescheduled");
  assert.equal(reconciled, 0);
  assert.equal(scheduled, 1);
});

test("watchdog reschedules when terminal reconciliation transiently fails", async () => {
  let scheduled = 0;
  const result = await reconcileGenerationWorkflowWatchdogHandler(
    watchdogCtx() as never,
    watchdogArgs() as never,
    {
      statusWorkflow: async () => ({ type: "completed", result: null }),
      reconcileCompletion: async () => {
        throw new Error("transaction conflict");
      },
      scheduleWatchdog: async () => {
        scheduled += 1;
      },
    },
  );
  assert.equal(result, "rescheduled");
  assert.equal(scheduled, 1);
});
