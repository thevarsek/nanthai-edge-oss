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

test("runGenerationHandler intersects enabled integrations and schedules post-processing for successful runs", async () => {
  const registry = { tag: "registry" };
  const registryArgs: Record<string, unknown>[] = [];
  const participantCalls: Array<Record<string, unknown>> = [];
  const scheduledCalls: Array<{ ref: unknown; args: Record<string, unknown> }> = [];

  const deps = createRunGenerationHandlerDepsForTest({
    now: () => 123,
    generation: {
      prepareGenerationContext: async () => ({
        allMessages: [
          {
            _id: "msg_user",
            attachments: [{ storageId: "file_1", mimeType: "application/pdf" }],
          },
        ],
        memoryContext: undefined,
        modelCapabilities: new Map(),
      }),
      getRequiredUserOpenRouterApiKey: async () => "key",
      generateForParticipant: async (args: unknown) => {
        participantCalls.push(args as Record<string, unknown>);
        return { deferredForSubagents: false, cancelled: false, failed: false };
      },
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
      buildProgressiveToolRegistry: (args: unknown) => {
        registryArgs.push(args as Record<string, unknown>);
        return registry as any;
      },
    },
  });

  const ctx = createMockCtx({
    runQuery: async () => ({
      isPro: false,
      hasSandboxRuntime: true,
    }),
    runMutation: async () => undefined,
    scheduler: {
      runAfter: async (_delay: number, ref: unknown, args: Record<string, unknown>) => {
        scheduledCalls.push({ ref, args });
      },
    },
  });

  await runGenerationHandler(ctx, buildArgs(), deps);

  assert.deepEqual(registryArgs[0], {
    enabledIntegrations: ["drive", "ms_calendar", "notion"],
    isPro: false,
    allowSubagents: false,
    hasSandboxRuntime: true,
    directToolNames: ["read_docx"],
  });
  assert.equal(participantCalls.length, 2);
  assert.equal(participantCalls[0]?.toolRegistry, registry);
  assert.equal(participantCalls[0]?.runtimeProfile, "mobileSandbox");
  assert.equal(scheduledCalls[0]?.args.chatId, "chat_1");
  assert.equal(scheduledCalls[0]?.args.userMessageId, "msg_user");
  assert.deepEqual(scheduledCalls[0]?.args.assistantMessageIds, ["msg_assistant_1", "msg_assistant_2"]);
  assert.equal(scheduledCalls[0]?.args.userId, "user_1");
});

test("runGenerationHandler marks mixed search outcomes as completed when any participant succeeds", async () => {
  const patches: Record<string, unknown>[] = [];
  let participantIndex = 0;

  const deps = createRunGenerationHandlerDepsForTest({
    now: () => 999,
    generation: {
      prepareGenerationContext: async () => ({
        allMessages: [],
        memoryContext: undefined,
        modelCapabilities: new Map(),
      }),
      getRequiredUserOpenRouterApiKey: async () => "key",
      generateForParticipant: async () => {
        const index = participantIndex;
        participantIndex += 1;
        if (index === 0) return { deferredForSubagents: false, cancelled: true, failed: false };
        return { deferredForSubagents: false, cancelled: false, failed: false };
      },
      failPendingParticipants: async () => undefined,
    },
    tools: {
      attachmentTriggeredReadToolNames: () => [],
      buildProgressiveToolRegistry: () => ({}) as any,
    },
  });

  const ctx = createMockCtx({
    runQuery: async () => ({
      isPro: true,
      hasSandboxRuntime: false,
    }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      patches.push(args);
    },
    scheduler: {
      runAfter: async () => undefined,
    },
  });

  const args = {
    ...buildArgs(),
    searchSessionId: "search_1",
  };

  await runGenerationHandler(ctx, args, deps);

  assert.deepEqual(patches[0], {
    sessionId: "search_1",
    patch: {
      status: "completed",
      progress: 100,
      currentPhase: "completed",
      completedAt: 999,
    },
  });
});

test("runGenerationHandler marks fully failed search runs as failed and skips post-process", async () => {
  const scheduledCalls: unknown[] = [];
  const patches: Record<string, unknown>[] = [];

  const deps = createRunGenerationHandlerDepsForTest({
    now: () => 456,
    generation: {
      prepareGenerationContext: async () => ({
        allMessages: [],
        memoryContext: undefined,
        modelCapabilities: new Map(),
      }),
      getRequiredUserOpenRouterApiKey: async () => "key",
      generateForParticipant: async () => ({
        deferredForSubagents: false,
        cancelled: false,
        failed: true,
      }),
      failPendingParticipants: async () => undefined,
    },
    tools: {
      attachmentTriggeredReadToolNames: () => [],
      buildProgressiveToolRegistry: () => ({}) as any,
    },
  });

  const ctx = createMockCtx({
    runQuery: async () => ({
      isPro: true,
      hasSandboxRuntime: false,
    }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      patches.push(args);
    },
    scheduler: {
      runAfter: async (...args: unknown[]) => {
        scheduledCalls.push(args);
      },
    },
  });

  await runGenerationHandler(ctx, {
    ...buildArgs(),
    searchSessionId: "search_2",
  }, deps);

  assert.equal(scheduledCalls.length, 0);
  assert.deepEqual(patches[0], {
    sessionId: "search_2",
    patch: {
      status: "failed",
      currentPhase: "failed",
      errorMessage: "All generation participants failed",
      completedAt: 456,
    },
  });
});

test("runGenerationHandler propagates cancellation failures to the search session and failPendingParticipants", async () => {
  const patches: Record<string, unknown>[] = [];
  const failureCalls: unknown[] = [];

  const deps = createRunGenerationHandlerDepsForTest({
    now: () => 777,
    generation: {
      prepareGenerationContext: async () => ({
        allMessages: [],
        memoryContext: undefined,
        modelCapabilities: new Map(),
      }),
      getRequiredUserOpenRouterApiKey: async () => "key",
      generateForParticipant: async () => {
        throw new Error("Generation cancelled by user");
      },
      failPendingParticipants: async (_ctx: unknown, _args: unknown, error: unknown) => {
        failureCalls.push(error);
      },
    },
    tools: {
      attachmentTriggeredReadToolNames: () => [],
      buildProgressiveToolRegistry: () => ({}) as any,
    },
  });

  const ctx = createMockCtx({
    runQuery: async () => ({
      isPro: true,
      hasSandboxRuntime: false,
    }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      patches.push(args);
    },
    scheduler: {
      runAfter: async () => undefined,
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
