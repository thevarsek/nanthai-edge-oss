import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";

import { internal } from "../_generated/api";
import { enqueueStep } from "../scheduledJobs/actions_execution";
import { reconcileScheduledStepWork } from "../scheduledJobs/execution_lifecycle";
import { durableWorkflow, interactiveWorkpool } from "../execution/components";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

const createScheduledExecutionTurnRef = getFunctionName(
  internal.scheduledJobs.mutations.createScheduledExecutionTurn,
);
const createSearchSessionRef = getFunctionName(
  internal.scheduledJobs.mutations.createSearchSession,
);
const getPersonaRef = getFunctionName(internal.chat.queries.getPersona);
const getKBFileContentsRef = getFunctionName(
  internal.scheduledJobs.queries.getKBFileContents,
);
const linkScheduledWorkpoolRef = getFunctionName(
  internal.scheduledJobs.execution_lifecycle.linkScheduledWorkpool,
);
const enqueueScheduledWebSearchRef = getFunctionName(
  internal.scheduledJobs.execution_lifecycle.enqueueScheduledWebSearch,
);
const startResearchPaperRef = getFunctionName(
  internal.execution.workflow_starts.startResearchPaper,
);
const enqueueGenerationRef = getFunctionName(
  internal.execution.queues.enqueueRunGeneration,
);

function buildCtx() {
  const mutationCalls: Array<{ ref: unknown; args: Record<string, unknown> }> =
    [];
  const queryCalls: Array<{ ref: unknown; args: Record<string, unknown> }> = [];
  const actionCalls: Array<{ ref: unknown; args: Record<string, unknown> }> =
    [];
  const scheduledCalls: Array<{ ref: unknown; args: Record<string, unknown> }> =
    [];

  const ctx = createMockCtx({
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push({ ref, args });
      const refName = getFunctionName(ref as any);
      if (refName === createScheduledExecutionTurnRef) {
        return {
          created: true,
          userMessageId: "msg_user",
          assistantMsgId: "msg_assistant",
          genJobId: "job_generation",
        };
      }
      if (refName === createSearchSessionRef) {
        return "search_session";
      }
      if (refName === linkScheduledWorkpoolRef) return undefined;
      if (refName === enqueueScheduledWebSearchRef) {
        scheduledCalls.push({ ref, args });
        return "work_scheduled_web";
      }
      if (refName === startResearchPaperRef) return "workflow_scheduled_research";
      if (refName === enqueueGenerationRef) {
        scheduledCalls.push({ ref, args });
        return "workflow_scheduled_generation";
      }
      throw new Error(`unexpected mutation: ${refName}`);
    },
    runQuery: async (ref: unknown, args: Record<string, unknown>) => {
      queryCalls.push({ ref, args });
      if (getFunctionName(ref as any) === getPersonaRef) {
        return {
          modelId: "anthropic/claude-4",
          systemPrompt: "Persona prompt",
          temperature: 0.2,
          maxTokens: 1200,
          displayName: "Researcher",
          avatarEmoji: "🧠",
          avatarImageUrl: "https://example.com/avatar.png",
          includeReasoning: true,
          reasoningEffort: "medium",
        };
      }
      throw new Error(`unexpected query: ${getFunctionName(ref as any)}`);
    },
    runAction: async (ref: unknown, args: Record<string, unknown>) => {
      actionCalls.push({ ref, args });
      if (getFunctionName(ref as any) !== getKBFileContentsRef) {
        throw new Error(`unexpected action: ${getFunctionName(ref as any)}`);
      }
      return [{ storageId: "kb_1", content: "Use this context." }];
    },
    scheduler: {
      runAfter: async (
        _delay: number,
        ref: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduledCalls.push({ ref, args });
      },
    },
  });

  return { ctx, mutationCalls, queryCalls, actionCalls, scheduledCalls };
}

test("enqueueStep idempotently reroutes an existing durable turn", async () => {
  const { ctx } = buildCtx();
  const calls: string[] = [];
  ctx.runMutation = (async (ref: unknown) => {
    const name = getFunctionName(ref as never);
    calls.push(name);
    if (name === createScheduledExecutionTurnRef) {
      return {
        created: false,
        userMessageId: "msg_user",
        assistantMsgId: "msg_assistant",
        genJobId: "job_generation",
      };
    }
    if (name === enqueueGenerationRef) return "workflow_existing";
    throw new Error(`unexpected mutation: ${name}`);
  }) as typeof ctx.runMutation;

  await enqueueStep(ctx, {
    jobId: "job_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    executionId: "exec_1",
    step: {
      prompt: "Summarize updates",
      modelId: "openai/gpt-5",
      searchMode: "none",
    },
    stepIndex: 0,
  });

  assert.deepEqual(calls, [createScheduledExecutionTurnRef, enqueueGenerationRef]);
});

test("enqueueStep routes basic search through the durable generation Workflow", async () => {
  const { ctx, mutationCalls, scheduledCalls } = buildCtx();

  await enqueueStep(ctx, {
    jobId: "job_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    executionId: "exec_1",
    step: {
      prompt: "Summarize updates",
      modelId: "openai/gpt-5",
      webSearchEnabled: true,
      searchComplexity: 1.6,
      turnSkillOverrides: [{ skillId: "skill_1" as any, state: "available" }],
      turnIntegrationOverrides: [
        { integrationId: "gmail", enabled: true },
        { integrationId: "drive", enabled: false },
      ],
    },
    stepIndex: 0,
  });

  assert.equal(mutationCalls[0]?.args.stepTitle, "Step 1");
  assert.equal(scheduledCalls.length, 1);
  assert.equal(scheduledCalls[0]?.args.webSearchEnabled, true);
  assert.deepEqual(scheduledCalls[0]?.args.turnSkillOverrides, [
    { skillId: "skill_1", state: "available" },
  ]);
  assert.deepEqual(scheduledCalls[0]?.args.turnIntegrationOverrides, [
    { integrationId: "gmail", enabled: true },
    { integrationId: "drive", enabled: false },
  ]);
  assert.equal(
    (scheduledCalls[0]?.args.participants as Array<{ modelId: string }>)[0]
      ?.modelId,
    "openai/gpt-5",
  );
  assert.equal(getFunctionName(scheduledCalls[0]?.ref as never), enqueueGenerationRef);
});

test("a failed scheduled Workpool operation signals the waiting Workflow", async (t) => {
  const sent: Array<Record<string, unknown>> = [];
  t.mock.method(durableWorkflow, "sendEvent", async (
    _ctx: unknown,
    args: unknown,
  ) => {
    sent.push(args as Record<string, unknown>);
  });
  const handler = (reconcileScheduledStepWork as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<void>;
  })._handler;
  await handler({
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => null,
          first: async () => null,
        }),
      }),
      get: async () => ({
        _id: "job_1",
        activeWorkflowId: "workflow_1",
        activeExecutionId: "exec_1",
        activeStepIndex: 0,
      }),
    },
  }, {
    context: {
      jobId: "job_1",
      executionId: "exec_1",
      stepIndex: 0,
      assistantMessageId: "msg_assistant",
    },
    result: { kind: "failed", error: "worker crashed" },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.name, "scheduled-step-0-terminal");
  assert.deepEqual(sent[0]?.value, {
    status: "failed",
    assistantMessageId: "msg_assistant",
    error: "worker crashed",
  });
});

test("a successful scheduled worker without a durable outcome fails instead of stranding", async (t) => {
  const sent: Array<Record<string, unknown>> = [];
  t.mock.method(durableWorkflow, "sendEvent", async (
    _ctx: unknown,
    args: unknown,
  ) => {
    sent.push(args as Record<string, unknown>);
  });
  const handler = (reconcileScheduledStepWork as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<void>;
  })._handler;
  await handler({
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => null,
          first: async () => null,
        }),
      }),
      get: async (id: string) => id === "msg_assistant"
        ? { _id: id, status: "streaming" }
        : {
            _id: "job_1",
            activeWorkflowId: "workflow_1",
            activeExecutionId: "exec_1",
            activeStepIndex: 0,
          },
    },
  }, {
    workId: "work_1",
    context: {
      jobId: "job_1",
      executionId: "exec_1",
      stepIndex: 0,
      assistantMessageId: "msg_assistant",
    },
    result: { kind: "success", returnValue: null },
  });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.value, {
    status: "failed",
    assistantMessageId: "msg_assistant",
    error: "Scheduled worker returned without a terminal message or durable generation handoff.",
  });
});

test("a late scheduled signal does not roll back terminal reconciliation", async (t) => {
  t.mock.method(durableWorkflow, "sendEvent", async () => {
    throw new Error("Workflow not running: [object Object]");
  });
  const handler = (reconcileScheduledStepWork as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<void>;
  })._handler;
  await assert.doesNotReject(handler({
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => null,
          first: async () => null,
        }),
      }),
      get: async (id: string) => id === "msg_assistant"
        ? { _id: id, status: "completed" }
        : {
            _id: "job_1",
            activeWorkflowId: "workflow_1",
            activeExecutionId: "exec_1",
            activeStepIndex: 0,
          },
    },
  }, {
    workId: "work_1",
    context: {
      jobId: "job_1",
      executionId: "exec_1",
      stepIndex: 0,
      assistantMessageId: "msg_assistant",
    },
    result: { kind: "success", returnValue: null },
  }));
});

test("a late failed scheduled callback preserves a completed message", async (t) => {
  const sent: Array<Record<string, unknown>> = [];
  t.mock.method(durableWorkflow, "sendEvent", async (
    _ctx: unknown,
    args: unknown,
  ) => {
    sent.push(args as Record<string, unknown>);
  });
  const handler = (reconcileScheduledStepWork as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<void>;
  })._handler;
  await handler({
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => null,
          first: async () => null,
        }),
      }),
      get: async (id: string) => id === "msg_assistant"
        ? { _id: id, status: "completed" }
        : {
            _id: "job_1",
            activeWorkflowId: "workflow_1",
            activeExecutionId: "exec_1",
            activeStepIndex: 0,
          },
    },
  }, {
    workId: "work_1",
    context: {
      jobId: "job_1",
      executionId: "exec_1",
      stepIndex: 0,
      assistantMessageId: "msg_assistant",
    },
    result: { kind: "failed", error: "late worker error" },
  });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.value, {
    status: "completed",
    assistantMessageId: "msg_assistant",
    error: undefined,
  });
});

test("enqueueStep resolves persona and knowledge-base context before routing web search", async (t) => {
  const { ctx, mutationCalls, actionCalls, scheduledCalls } = buildCtx();
  t.mock.method(
    interactiveWorkpool,
    "enqueueAction",
    async (_ctx: unknown, ref: unknown, args: unknown) => {
      scheduledCalls.push({ ref, args: args as Record<string, unknown> });
      return "work_scheduled_web" as never;
    },
  );

  await enqueueStep(ctx, {
    jobId: "job_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    executionId: "exec_1",
    step: {
      title: "Research",
      prompt: "Draft a research brief",
      modelId: "openai/gpt-5",
      personaId: "persona_1" as any,
      knowledgeBaseFileIds: ["kb_1" as any],
      searchMode: "web",
      searchComplexity: 2.4,
      enabledIntegrations: ["gmail"],
      turnIntegrationOverrides: [{ integrationId: "gmail", enabled: false }],
    },
    stepIndex: 0,
    previousAssistantContent: "Prior answer",
  });

  assert.equal(actionCalls.length, 1);
  assert.equal(mutationCalls[0]?.args.modelId, "anthropic/claude-4");
  assert.match(
    mutationCalls[0]?.args.content as string,
    /\[Knowledge Base Context\]/,
  );
  assert.match(
    mutationCalls[0]?.args.content as string,
    /\[Previous Step Output\]/,
  );
  assert.equal(scheduledCalls.length, 1);
  assert.equal(scheduledCalls[0]?.args.complexity, 2);
  assert.equal(scheduledCalls[0]?.args.personaId, "persona_1");
  assert.deepEqual(scheduledCalls[0]?.args.turnIntegrationOverrides, [
    { integrationId: "gmail", enabled: false },
  ]);
});

test("enqueueStep routes research mode through the owned paper workflow", async () => {
  const { ctx, mutationCalls } = buildCtx();

  await enqueueStep(ctx, {
    jobId: "job_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    executionId: "exec_1",
    step: {
      prompt: "Investigate papers",
      modelId: "openai/gpt-5",
      searchMode: "research",
      searchComplexity: 3,
      enabledIntegrations: ["gmail"],
      turnIntegrationOverrides: [{ integrationId: "gmail", enabled: false }],
    },
    stepIndex: 1,
  });

  const researchCall = mutationCalls.find((call) =>
    getFunctionName(call.ref as never) === startResearchPaperRef
  );
  assert.equal(researchCall?.args.complexity, 3);
  assert.deepEqual(researchCall?.args.turnIntegrationOverrides, [
    { integrationId: "gmail", enabled: false },
  ]);
});

test("enqueueStep preserves explicit reasoning flags on durable generation steps", async () => {
  const { ctx, scheduledCalls } = buildCtx();

  await enqueueStep(ctx, {
    jobId: "job_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    executionId: "exec_1",
    step: {
      prompt: "Summarize updates",
      modelId: "openai/gpt-5",
      searchMode: "none",
      includeReasoning: false,
      reasoningEffort: "low",
    },
    stepIndex: 0,
  });

  const participant = (
    scheduledCalls[0]?.args.participants as Array<Record<string, unknown>>
  )[0];
  assert.equal(participant.includeReasoning, false);
  assert.equal(participant.reasoningEffort, "low");
});

test("enqueueStep falls back when a configured persona is unavailable", async (t) => {
  const { ctx, mutationCalls, scheduledCalls } = buildCtx();
  t.mock.method(
    interactiveWorkpool,
    "enqueueAction",
    async (_ctx: unknown, ref: unknown, args: unknown) => {
      scheduledCalls.push({ ref, args: args as Record<string, unknown> });
      return "work_scheduled_fallback" as never;
    },
  );
  ctx.runQuery = (async () => null) as any;

  await enqueueStep(ctx, {
    jobId: "job_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    executionId: "exec_1",
    step: {
      prompt: "Search without persona",
      modelId: "openai/gpt-5",
      personaId: "deleted_persona" as any,
      searchMode: "web",
      searchComplexity: undefined,
      includeReasoning: true,
    },
    stepIndex: 2,
  });

  assert.equal(mutationCalls[0]?.args.modelId, "openai/gpt-5");
  assert.equal(mutationCalls[0]?.args.personaId, undefined);
  assert.equal(scheduledCalls[0]?.args.complexity, 1);
  assert.equal(scheduledCalls[0]?.args.personaId, undefined);
  assert.equal(scheduledCalls[0]?.args.includeReasoning, true);
});

test("enqueueStep ignores empty knowledge-base hydration results", async () => {
  const { ctx, mutationCalls, actionCalls } = buildCtx();
  ctx.runAction = (async (ref: unknown, args: Record<string, unknown>) => {
    actionCalls.push({ ref, args });
    return [];
  }) as any;

  await enqueueStep(ctx, {
    jobId: "job_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    executionId: "exec_1",
    step: {
      prompt: "Plain prompt",
      modelId: "openai/gpt-5",
      knowledgeBaseFileIds: ["kb_missing" as any],
      searchMode: "basic",
    },
    stepIndex: 0,
  });

  assert.equal(actionCalls.length, 1);
  assert.equal(mutationCalls[0]?.args.content, "Plain prompt");
});
