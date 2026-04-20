import assert from "node:assert/strict";
import test from "node:test";

import {
  createRunGenerationHandlerDepsForTest,
  runGenerationHandler,
} from "../chat/actions_run_generation_handler";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";
import type { GenerationContext } from "../chat/queries_generation_context";

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

/** Build a default GenerationContext for tests. Override fields as needed. */
function buildGenCtx(overrides: Partial<GenerationContext> = {}): GenerationContext {
  return {
    isPro: false,
    currentUserMessage: { _id: "msg_user", attachments: [] },
    chatDoc: { _id: "chat_1", integrationOverrides: [] },
    skillIntegrationDefaults: { skillDefaults: undefined, integrationDefaults: undefined },
    connectedIntegrationIds: [],
    personasById: {},
    ...overrides,
  };
}

/** Create a mock ctx whose runQuery returns the given GenerationContext. */
function createCtxWithGenCtx(
  genCtx: GenerationContext,
  overrides: {
    runMutation?: (...args: any[]) => Promise<unknown>;
    scheduler?: Record<string, (...args: any[]) => Promise<unknown>>;
  } = {},
) {
  return createMockCtx({
    runQuery: async () => genCtx,
    runMutation: overrides.runMutation ?? (async () => undefined),
    scheduler: overrides.scheduler ?? {
      runAfter: async () => "scheduled_default",
    },
  });
}

test("runGenerationHandler intersects enabled integrations and schedules per-participant actions", async () => {
  const scheduledCalls: Array<Record<string, unknown>> = [];
  const mutationCalls: Array<Record<string, unknown>> = [];

  const deps = createRunGenerationHandlerDepsForTest({
    now: () => 123,
    generation: {
      failPendingParticipants: async () => undefined,
    },
    tools: {
      attachmentTriggeredReadToolNames: () => ["read_docx"],
    },
  });

  const ctx = createCtxWithGenCtx(
    buildGenCtx({
      isPro: false,
      currentUserMessage: {
        _id: "msg_user",
        attachments: [{ storageId: "file_1", mimeType: "application/pdf" }],
      },
      connectedIntegrationIds: ["drive", "outlook", "onedrive", "ms_calendar", "notion", "cloze", "slack"],
    }),
    {
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
    },
  );

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
    chatSkillOverrides: undefined,
    chatIntegrationOverrides: [],
    personaSkillOverrides: undefined,
    skillDefaults: undefined,
    integrationDefaults: undefined,
    enqueuedAt: 123,
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

  const ctx = createCtxWithGenCtx(
    buildGenCtx({ isPro: true }),
    {
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
    },
  );

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
    tools: {
      attachmentTriggeredReadToolNames: () => [],
    },
  });

  const ctx = createCtxWithGenCtx(
    buildGenCtx(),
    {
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
    },
  );

  await runGenerationHandler(ctx, buildArgs(), deps);

  assert.deepEqual(cancelledScheduledIds, ["scheduled_1"]);
  assert.equal(failureCalls.length, 1);
  assert.deepEqual(mutationCalls, [
    { jobId: "job_1", scheduledFunctionId: "scheduled_1", updateContinuation: false },
    { jobId: "job_1" },
  ]);
});

// ---------------------------------------------------------------------------
// Pre-refactor regression tests: persona resolution, overrides, pro/free gating
// ---------------------------------------------------------------------------

test("runGenerationHandler fetches persona docs and applies persona integration overrides per participant", async () => {
  const scheduledCalls: Array<Record<string, unknown>> = [];

  const deps = createRunGenerationHandlerDepsForTest({
    now: () => 1,
    generation: { failPendingParticipants: async () => undefined },
    tools: { attachmentTriggeredReadToolNames: () => [] },
  });

  // Persona disables drive, enables ms_calendar — but turn overrides enable both.
  // Connected: drive + microsoft set.
  const ctx = createCtxWithGenCtx(
    buildGenCtx({
      connectedIntegrationIds: ["drive", "outlook", "onedrive", "ms_calendar"],
      personasById: {
        persona_1: {
          _id: "persona_1",
          integrationOverrides: [
            { integrationId: "drive", enabled: false },
            { integrationId: "ms_calendar", enabled: true },
          ],
        },
      },
    }),
    {
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
          scheduledCalls.push(args);
          return `scheduled_${scheduledCalls.length}`;
        },
      },
    },
  );

  await runGenerationHandler(ctx, {
    ...buildArgs(),
    participants: [
      { modelId: "openai/gpt-5", messageId: "msg_assistant_1", jobId: "job_1", personaId: "persona_1" },
    ],
    enabledIntegrations: ["drive", "ms_calendar"],
  } as any, deps);

  assert.equal(scheduledCalls.length, 1);
  const effective = scheduledCalls[0].effectiveIntegrations as string[];
  assert.ok(effective.includes("drive"), "drive should be effective (turn override wins over persona)");
  assert.ok(effective.includes("ms_calendar"), "ms_calendar should be effective");
});

test("runGenerationHandler passes userDefaults integrationDefaults into resolution", async () => {
  const scheduledCalls: Array<Record<string, unknown>> = [];

  const deps = createRunGenerationHandlerDepsForTest({
    now: () => 1,
    generation: { failPendingParticipants: async () => undefined },
    tools: { attachmentTriggeredReadToolNames: () => [] },
  });

  const ctx = createCtxWithGenCtx(
    buildGenCtx({
      connectedIntegrationIds: ["drive", "gmail", "notion"],
      skillIntegrationDefaults: {
        skillDefaults: undefined,
        integrationDefaults: [
          { integrationId: "drive", enabled: true },
          { integrationId: "gmail", enabled: true },
          { integrationId: "notion", enabled: true },
        ],
      },
    }),
    {
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
          scheduledCalls.push(args);
          return `scheduled_${scheduledCalls.length}`;
        },
      },
    },
  );

  await runGenerationHandler(ctx, {
    ...buildArgs(),
    participants: [
      { modelId: "openai/gpt-5", messageId: "msg_assistant_1", jobId: "job_1" },
    ],
    enabledIntegrations: undefined,
    turnIntegrationOverrides: undefined,
  } as any, deps);

  assert.equal(scheduledCalls.length, 1);
  const effective = scheduledCalls[0].effectiveIntegrations as string[];
  assert.ok(effective.includes("drive"), "drive enabled by settings default");
  assert.ok(effective.includes("gmail"), "gmail enabled by settings default");
  assert.ok(effective.includes("notion"), "notion enabled by settings default");
});

test("runGenerationHandler sets isPro=true and allowSubagents=true for pro user with single participant", async () => {
  const scheduledCalls: Array<Record<string, unknown>> = [];

  const deps = createRunGenerationHandlerDepsForTest({
    now: () => 1,
    generation: { failPendingParticipants: async () => undefined },
    tools: { attachmentTriggeredReadToolNames: () => [] },
  });

  const ctx = createCtxWithGenCtx(
    buildGenCtx({ isPro: true }),
    {
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
          scheduledCalls.push(args);
          return "scheduled_1";
        },
      },
    },
  );

  await runGenerationHandler(ctx, {
    ...buildArgs(),
    participants: [
      { modelId: "openai/gpt-5", messageId: "msg_assistant_1", jobId: "job_1" },
    ],
    subagentsEnabled: true,
  } as any, deps);

  assert.equal(scheduledCalls.length, 1);
  assert.equal(scheduledCalls[0].isPro, true);
  assert.equal(scheduledCalls[0].allowSubagents, true);
});

test("runGenerationHandler disallows subagents when multiple participants even if subagentsEnabled", async () => {
  const scheduledCalls: Array<Record<string, unknown>> = [];

  const deps = createRunGenerationHandlerDepsForTest({
    now: () => 1,
    generation: { failPendingParticipants: async () => undefined },
    tools: { attachmentTriggeredReadToolNames: () => [] },
  });

  const ctx = createCtxWithGenCtx(
    buildGenCtx({ isPro: true }),
    {
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
          scheduledCalls.push(args);
          return `scheduled_${scheduledCalls.length}`;
        },
      },
    },
  );

  await runGenerationHandler(ctx, {
    ...buildArgs(),
    subagentsEnabled: true,
  } as any, deps);

  assert.equal(scheduledCalls.length, 2);
  assert.equal(scheduledCalls[0].allowSubagents, false);
  assert.equal(scheduledCalls[1].allowSubagents, false);
});

test("runGenerationHandler passes videoConfig and turnIntegrationOverrides through to participants", async () => {
  const scheduledCalls: Array<Record<string, unknown>> = [];

  const deps = createRunGenerationHandlerDepsForTest({
    now: () => 1,
    generation: { failPendingParticipants: async () => undefined },
    tools: { attachmentTriggeredReadToolNames: () => [] },
  });

  const ctx = createCtxWithGenCtx(
    buildGenCtx({
      connectedIntegrationIds: ["drive"],
    }),
    {
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
          scheduledCalls.push(args);
          return "scheduled_1";
        },
      },
    },
  );

  await runGenerationHandler(ctx, {
    ...buildArgs(),
    participants: [
      { modelId: "openai/gpt-5", messageId: "msg_assistant_1", jobId: "job_1" },
    ],
    videoConfig: { resolution: "1080p", aspectRatio: "16:9" },
    turnIntegrationOverrides: [{ integrationId: "drive", enabled: false }],
    enabledIntegrations: undefined,
  } as any, deps);

  assert.equal(scheduledCalls.length, 1);
  assert.deepEqual(scheduledCalls[0].videoConfig, { resolution: "1080p", aspectRatio: "16:9" });
  const effective = scheduledCalls[0].effectiveIntegrations as string[];
  assert.ok(!effective.includes("drive"), "drive should be disabled by turn override");
});

test("runGenerationHandler with no connected integrations produces empty effectiveIntegrations", async () => {
  const scheduledCalls: Array<Record<string, unknown>> = [];

  const deps = createRunGenerationHandlerDepsForTest({
    now: () => 1,
    generation: { failPendingParticipants: async () => undefined },
    tools: { attachmentTriggeredReadToolNames: () => [] },
  });

  const ctx = createCtxWithGenCtx(
    buildGenCtx(),
    {
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
          scheduledCalls.push(args);
          return "scheduled_1";
        },
      },
    },
  );

  await runGenerationHandler(ctx, {
    ...buildArgs(),
    participants: [
      { modelId: "openai/gpt-5", messageId: "msg_assistant_1", jobId: "job_1" },
    ],
    enabledIntegrations: ["drive", "gmail", "notion"],
  } as any, deps);

  assert.equal(scheduledCalls.length, 1);
  assert.deepEqual(scheduledCalls[0].effectiveIntegrations, []);
});

test("runGenerationHandler deduplicates persona fetches for shared persona across participants", async () => {
  const scheduledCalls: Array<Record<string, unknown>> = [];

  const deps = createRunGenerationHandlerDepsForTest({
    now: () => 1,
    generation: { failPendingParticipants: async () => undefined },
    tools: { attachmentTriggeredReadToolNames: () => [] },
  });

  // Both participants share persona_1 — the consolidated query receives deduplicated personaIds
  const ctx = createCtxWithGenCtx(
    buildGenCtx({
      personasById: {
        persona_1: { _id: "persona_1", integrationOverrides: [] },
      },
    }),
    {
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
          scheduledCalls.push(args);
          return `scheduled_${scheduledCalls.length}`;
        },
      },
    },
  );

  await runGenerationHandler(ctx, {
    ...buildArgs(),
    participants: [
      { modelId: "openai/gpt-5", messageId: "msg_assistant_1", jobId: "job_1", personaId: "persona_1" },
      { modelId: "openai/gpt-4.1", messageId: "msg_assistant_2", jobId: "job_2", personaId: "persona_1" },
    ],
    enabledIntegrations: undefined,
  } as any, deps);

  assert.equal(scheduledCalls.length, 2);
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
    tools: {
      attachmentTriggeredReadToolNames: () => [],
    },
  });

  const ctx = createCtxWithGenCtx(
    buildGenCtx(),
    {
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
    },
  );

  await runGenerationHandler(ctx, buildArgs(), deps);

  assert.equal(failureArgs.length, 1);
  assert.deepEqual(
    (failureArgs[0].participants as Array<Record<string, unknown>>).map((participant) => participant.jobId),
    ["job_2"],
  );
});
