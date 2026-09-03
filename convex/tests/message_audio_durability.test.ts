import assert from "node:assert/strict";
import test from "node:test";

import { clearAudioGenerationForExecutionRun } from
  "../chat/audio_cleanup";
import { cancelActiveMessageAudioForChat } from "../chat/audio_cancel";
import { patchMessageAudioHandler } from
  "../chat/audio_mutation_handlers";
import {
  startMessageAudioWorkflow,
  type MessageAudioWorkflowStartDeps,
} from "../chat/audio_workflow_start";
import { isCancellationRequestedHandler } from "../execution/queries";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";

test("message audio starts one owned Workflow after setting the visible flag", async () => {
  const message = {
    _id: "message_1",
    chatId: "chat_1",
    role: "assistant",
    content: "Narrate this",
  };
  const chat = { _id: "chat_1", userId: "user_1" };
  const events: string[] = [];
  const executionArgs: Array<Record<string, unknown>> = [];
  const workflowArgs: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      get: async (id: string) => id === message._id ? message : id === chat._id ? chat : null,
      patch: async (id: string, value: Record<string, unknown>) => {
        events.push(`patch:${id}`);
        if (id === message._id) Object.assign(message, value);
      },
    },
  } as never;
  const deps: MessageAudioWorkflowStartDeps = {
    createExecution: async (_ctx, args) => {
      events.push("create-execution");
      executionArgs.push(args as unknown as Record<string, unknown>);
      return {
        runId: "run_1" as never,
        attemptId: "attempt_1" as never,
        fence: 1,
        leaseExpiresAt: 1,
      };
    },
    claimExecution: async () => {
      events.push("claim-execution");
      return {
        runId: "run_1" as never,
        attemptId: "attempt_1" as never,
        fence: 1,
        leaseExpiresAt: 1,
      };
    },
    startWorkflow: async (_ctx, args) => {
      events.push("start-workflow");
      workflowArgs.push(args as unknown as Record<string, unknown>);
      return "workflow_1";
    },
    linkComponent: async () => {
      events.push("link-component");
      return "component_1" as never;
    },
    scheduleWatchdog: async () => {
      events.push("schedule-watchdog");
    },
  };

  const started = await startMessageAudioWorkflow(ctx, {
    messageId: "message_1" as never,
    chatId: "chat_1" as never,
    userId: "user_1",
    modelId: "speech/model",
  }, deps);

  assert.deepEqual(started, { started: true, workflowId: "workflow_1" });
  assert.equal((message as { audioGenerating?: boolean }).audioGenerating, true);
  assert.deepEqual(events, [
    "patch:message_1",
    "create-execution",
    "claim-execution",
    "start-workflow",
    "patch:attempt_1",
    "link-component",
    "schedule-watchdog",
  ]);
  assert.equal(executionArgs[0]?.domainType, "message_speech");
  assert.equal(executionArgs[0]?.sourceMessageId, "message_1");
  assert.equal(
    (executionArgs[0]?.initialAttempt as Record<string, unknown>).modelId,
    "speech/model",
  );
  assert.equal(workflowArgs[0]?.messageId, "message_1");

  const duplicate = await startMessageAudioWorkflow(ctx, {
    messageId: "message_1" as never,
    chatId: "chat_1" as never,
    userId: "user_1",
  }, deps);
  assert.deepEqual(duplicate, { started: false });
  assert.equal(events.filter((event) => event === "start-workflow").length, 1);
});

test("message audio cancellation follows execution, chat, and account deletion state", async () => {
  const rows = {
    executionAttempts: [{
      _id: "attempt_1",
      runId: "run_1",
      fence: 2,
      status: "running",
    }],
    executionRuns: [{
      _id: "run_1",
      activeAttemptId: "attempt_1",
      userId: "user_1",
      chatId: "chat_1",
      state: "running",
    }],
    chats: [{ _id: "chat_1", userId: "user_1", isDeleting: false }],
    accountDeletionTombstones: [] as Array<Record<string, unknown>>,
  };
  const ctx = createStatefulMockCtx(rows);
  const args = { attemptId: "attempt_1" as never, fence: 2 };

  assert.equal(await isCancellationRequestedHandler(ctx as never, args), false);
  assert.equal(
    await isCancellationRequestedHandler(ctx as never, { ...args, fence: 1 }),
    true,
  );
  rows.executionRuns[0].state = "cancelling";
  assert.equal(await isCancellationRequestedHandler(ctx as never, args), true);
  rows.executionRuns[0].state = "running";
  rows.chats[0].isDeleting = true;
  assert.equal(await isCancellationRequestedHandler(ctx as never, args), true);
  rows.chats[0].isDeleting = false;
  rows.accountDeletionTombstones.push({ _id: "delete_1", userId: "user_1" });
  assert.equal(await isCancellationRequestedHandler(ctx as never, args), true);
});

test("message audio teardown clears its loading flag and stale writers cannot publish", async () => {
  const rows = {
    messages: [{
      _id: "message_1",
      chatId: "chat_1",
      role: "assistant",
      audioGenerating: true,
      audioStorageId: "old_audio",
    }],
    chats: [{ _id: "chat_1", userId: "user_1" }],
    executionRuns: [{
      _id: "run_1",
      activeAttemptId: "attempt_1",
      userId: "user_1",
      chatId: "chat_1",
      sourceMessageId: "message_1",
      domainType: "message_speech",
      state: "running",
    }],
    executionAttempts: [{
      _id: "attempt_1",
      runId: "run_1",
      fence: 2,
      status: "running",
    }],
    accountDeletionTombstones: [] as Array<Record<string, unknown>>,
  };
  const ctx = createStatefulMockCtx(rows);
  await assert.rejects(
    patchMessageAudioHandler(ctx as never, {
      messageId: "message_1" as never,
      audioStorageId: "new_audio" as never,
      executionRunId: "run_1" as never,
      executionAttemptId: "attempt_1" as never,
      executionFence: 1,
    }),
    /STALE_EXECUTION_FENCE/,
  );
  assert.deepEqual(ctx.storageDeletes, []);
  assert.equal(rows.messages[0].audioStorageId, "old_audio");

  await clearAudioGenerationForExecutionRun(
    ctx as never,
    rows.executionRuns[0] as never,
  );
  assert.equal(rows.messages[0].audioGenerating, undefined);
});

test("an older speech teardown preserves the loading flag for a newer retry", async () => {
  const rows = {
    messages: [{
      _id: "message_1",
      chatId: "chat_1",
      role: "assistant",
      audioGenerating: true as boolean | undefined,
    }],
    chats: [{ _id: "chat_1", userId: "user_1" }],
    executionRuns: [{
      _id: "run_old",
      userId: "user_1",
      chatId: "chat_1",
      sourceMessageId: "message_1",
      domainType: "message_speech",
      domainId: "message_1",
      state: "cancelling",
    }, {
      _id: "run_retry",
      userId: "user_1",
      chatId: "chat_1",
      sourceMessageId: "message_1",
      domainType: "message_speech",
      domainId: "message_1",
      state: "running",
    }],
  };
  const ctx = createStatefulMockCtx(rows);

  await clearAudioGenerationForExecutionRun(ctx as never, rows.executionRuns[0] as never);
  assert.equal(rows.messages[0].audioGenerating, true);

  rows.executionRuns[1].state = "completed";
  await clearAudioGenerationForExecutionRun(ctx as never, rows.executionRuns[0] as never);
  assert.equal(rows.messages[0].audioGenerating, undefined);
});

test("chat Stop cancels standalone message speech and clears its loading state", async () => {
  const rows = {
    messages: [{
      _id: "message_1",
      chatId: "chat_1",
      role: "assistant",
      audioGenerating: true,
    }],
    chats: [{ _id: "chat_1", userId: "user_1" }],
    executionRuns: [{
      _id: "run_1",
      activeAttemptId: "attempt_1",
      userId: "user_1",
      chatId: "chat_1",
      sourceMessageId: "message_1",
      domainType: "message_speech",
      state: "running",
      nextEventSequence: 1,
    }],
    executionAttempts: [{
      _id: "attempt_1",
      runId: "run_1",
      fence: 2,
      status: "running",
      adapterId: "convex-workflow",
      componentOperationId: "workflow_1",
    }],
    executionTeardownTasks: [] as Array<Record<string, unknown>>,
    executionComponentRefs: [] as Array<Record<string, unknown>>,
    runtimeSessionBindings: [] as Array<Record<string, unknown>>,
    runtimeCommands: [] as Array<Record<string, unknown>>,
    executionOperations: [] as Array<Record<string, unknown>>,
    analyticsWorkflowRuns: [] as Array<Record<string, unknown>>,
    advisorRuns: [] as Array<Record<string, unknown>>,
  };
  const ctx = createStatefulMockCtx(rows);

  const count = await cancelActiveMessageAudioForChat(ctx as never, {
    chatId: "chat_1" as never,
    userId: "user_1",
  });

  assert.equal(count, 1);
  assert.equal(rows.executionRuns[0].state, "cancelling");
  assert.equal(rows.messages[0].audioGenerating, undefined);
  assert.ok(ctx.scheduled.some((entry) => entry.runId === "run_1"));
});
