import assert from "node:assert/strict";
import test from "node:test";

import {
  createRunGenerationHandlerDepsForTest,
  runGenerationHandler,
} from "../chat/actions_run_generation_handler";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

function buildArgs() {
  return {
    chatId: "chat_1",
    userMessageId: "msg_user",
    assistantMessageIds: ["msg_assistant_1", "msg_assistant_2"],
    generationJobIds: ["job_1", "job_2"],
    participants: [
      { modelId: "openai/gpt-5", messageId: "msg_assistant_1", jobId: "job_1" },
      { modelId: "openai/gpt-4.1", messageId: "msg_assistant_2", jobId: "job_2" },
    ],
    userId: "user_1",
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    enabledIntegrations: ["drive", "gmail", "ms_calendar", "apple_calendar", "notion"],
    subagentsEnabled: true,
  } as any;
}

test("runGenerationHandler intersects enabled integrations and schedules per-participant actions", async () => {
  const scheduledCalls: Array<Record<string, unknown>> = [];
  const mutationCalls: Array<Record<string, unknown>> = [];

  const deps = createRunGenerationHandlerDepsForTest({
    now: () => 123,
    generation: {
      failPendingParticipants: async () => undefined,
    },
    integrations: {
      getGrantedGoogleIntegrations: async () => ["drive"],
      checkMicrosoftConnection: async () => true,
      checkAppleCalendarConnection: async () => false,
      checkNotionConnection: async () => true,
    },
    tools: {
      attachmentTriggeredReadToolNames: () => ["read_docx"],
    },
  });

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("userId" in args) {
        return { isPro: false };
      }
      if ("messageId" in args) {
        return {
          _id: "msg_user",
          attachments: [{ storageId: "file_1", mimeType: "application/pdf" }],
        };
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      return undefined;
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduledCalls.push(args);
        return `scheduled_${scheduledCalls.length}`;
      },
    },
  });

  await runGenerationHandler(ctx, buildArgs(), deps);

  assert.equal(scheduledCalls.length, 2);
  assert.deepEqual(scheduledCalls[0], {
    chatId: "chat_1",
    userMessageId: "msg_user",
    assistantMessageIds: ["msg_assistant_1", "msg_assistant_2"],
    generationJobIds: ["job_1", "job_2"],
    participant: { modelId: "openai/gpt-5", messageId: "msg_assistant_1", jobId: "job_1" },
    userId: "user_1",
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    effectiveIntegrations: ["drive", "ms_calendar", "notion"],
    directToolNames: ["read_docx"],
    isPro: false,
    allowSubagents: false,
    searchSessionId: undefined,
    resumeExpected: false,
    videoConfig: undefined,
  });
  assert.deepEqual(mutationCalls, [
    { jobId: "job_1", scheduledFunctionId: "scheduled_1", updateContinuation: false },
    { jobId: "job_2", scheduledFunctionId: "scheduled_2", updateContinuation: false },
  ]);
});

test("runGenerationHandler propagates coordinator failures to search sessions and failPendingParticipants", async () => {
  const patches: Record<string, unknown>[] = [];
  const failureCalls: unknown[] = [];
  let scheduleCount = 0;

  const deps = createRunGenerationHandlerDepsForTest({
    now: () => 777,
    generation: {
      failPendingParticipants: async (_ctx: unknown, _args: unknown, error: unknown) => {
        failureCalls.push(error);
      },
    },
    tools: {
      attachmentTriggeredReadToolNames: () => [],
    },
  });

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("userId" in args) {
        return { isPro: true };
      }
      if ("messageId" in args) {
        return { _id: "msg_user", attachments: [] };
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      patches.push(args);
      return undefined;
    },
    scheduler: {
      runAfter: async () => {
        scheduleCount += 1;
        if (scheduleCount === 1) {
          throw new Error("Generation cancelled by user");
        }
        return "scheduled_unused";
      },
    },
  });

  await runGenerationHandler(ctx, {
    ...buildArgs(),
    participants: [{ modelId: "openai/gpt-5", messageId: "msg_assistant_1", jobId: "job_1" }],
    searchSessionId: "search_3",
  }, deps);

  assert.equal(failureCalls.length, 1);
  assert.deepEqual(patches[0], {
    sessionId: "search_3",
    patch: {
      status: "cancelled",
      currentPhase: "cancelled",
      errorMessage: undefined,
      completedAt: 777,
    },
  });
});

test("runGenerationHandler cancels already scheduled participants when a later dispatch fails", async () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  const cancelledScheduledIds: string[] = [];
  const failureCalls: unknown[] = [];
  let scheduleCount = 0;

  const deps = createRunGenerationHandlerDepsForTest({
    generation: {
      failPendingParticipants: async (_ctx: unknown, _args: unknown, error: unknown) => {
        failureCalls.push(error);
      },
    },
    integrations: {
      getGrantedGoogleIntegrations: async () => [],
      checkMicrosoftConnection: async () => false,
      checkAppleCalendarConnection: async () => false,
      checkNotionConnection: async () => false,
    },
    tools: {
      attachmentTriggeredReadToolNames: () => [],
    },
  });

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("userId" in args) {
        return { isPro: false };
      }
      if ("messageId" in args) {
        return { _id: "msg_user", attachments: [] };
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      return undefined;
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, _args: Record<string, unknown>) => {
        scheduleCount += 1;
        if (scheduleCount === 1) {
          return "scheduled_1";
        }
        throw new Error("scheduler broke");
      },
      cancel: async (scheduledFunctionId: string) => {
        cancelledScheduledIds.push(scheduledFunctionId);
      },
    },
  });

  await runGenerationHandler(ctx, buildArgs(), deps);

  assert.deepEqual(cancelledScheduledIds, ["scheduled_1"]);
  assert.equal(failureCalls.length, 1);
  assert.deepEqual(mutationCalls, [
    { jobId: "job_1", scheduledFunctionId: "scheduled_1", updateContinuation: false },
    { jobId: "job_1" },
  ]);
});

test("runGenerationHandler only fails participants that were never started or were cancelled before start", async () => {
  const failureArgs: Array<Record<string, unknown>> = [];
  let scheduleCount = 0;

  const deps = createRunGenerationHandlerDepsForTest({
    generation: {
      failPendingParticipants: async (_ctx: unknown, args: Record<string, unknown>) => {
        failureArgs.push(args);
      },
    },
    integrations: {
      getGrantedGoogleIntegrations: async () => [],
      checkMicrosoftConnection: async () => false,
      checkAppleCalendarConnection: async () => false,
      checkNotionConnection: async () => false,
    },
    tools: {
      attachmentTriggeredReadToolNames: () => [],
    },
  });

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("userId" in args) {
        return { isPro: false };
      }
      if ("messageId" in args) {
        return { _id: "msg_user", attachments: [] };
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async () => undefined,
    scheduler: {
      runAfter: async () => {
        scheduleCount += 1;
        if (scheduleCount === 1) {
          return "scheduled_1";
        }
        throw new Error("scheduler broke");
      },
      cancel: async () => {
        throw new Error("already started");
      },
    },
  });

  await runGenerationHandler(ctx, buildArgs(), deps);

  assert.equal(failureArgs.length, 1);
  assert.deepEqual(
    (failureArgs[0].participants as Array<Record<string, unknown>>).map((participant) => participant.jobId),
    ["job_2"],
  );
});
