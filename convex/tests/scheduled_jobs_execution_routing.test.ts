import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";

import { internal } from "../_generated/api";
import { enqueueStep } from "../scheduledJobs/actions_execution";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

const createScheduledExecutionTurnRef = getFunctionName(
  internal.scheduledJobs.mutations.createScheduledExecutionTurn,
);
const createSearchSessionRef = getFunctionName(
  internal.scheduledJobs.mutations.createSearchSession,
);
const getPersonaRef = getFunctionName(internal.chat.queries.getPersona);
const getKBFileContentsRef = getFunctionName(internal.scheduledJobs.queries.getKBFileContents);

function buildCtx() {
  const mutationCalls: Array<{ ref: unknown; args: Record<string, unknown> }> = [];
  const queryCalls: Array<{ ref: unknown; args: Record<string, unknown> }> = [];
  const actionCalls: Array<{ ref: unknown; args: Record<string, unknown> }> = [];
  const scheduledCalls: Array<{ ref: unknown; args: Record<string, unknown> }> = [];

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
      runAfter: async (_delay: number, ref: unknown, args: Record<string, unknown>) => {
        scheduledCalls.push({ ref, args });
      },
    },
  });

  return { ctx, mutationCalls, queryCalls, actionCalls, scheduledCalls };
}

test("enqueueStep is a no-op when the execution turn already exists", async () => {
  const { ctx, scheduledCalls } = buildCtx();
  ctx.runMutation = async () => {
    return {
      created: false,
      userMessageId: "msg_user",
      assistantMsgId: "msg_assistant",
      genJobId: "job_generation",
    };
  };

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

  assert.equal(scheduledCalls.length, 0);
});

test("enqueueStep routes basic search via runGeneration with normalized params", async () => {
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
    },
    stepIndex: 0,
  });

  assert.equal(mutationCalls[0]?.args.stepTitle, "Step 1");
  assert.equal(scheduledCalls.length, 1);
  assert.equal(scheduledCalls[0]?.args.webSearchEnabled, true);
  assert.equal(
    (scheduledCalls[0]?.args.participants as Array<{ modelId: string }>)[0]?.modelId,
    "openai/gpt-5",
  );
});

test("enqueueStep resolves persona and knowledge-base context before routing web search", async () => {
  const { ctx, mutationCalls, actionCalls, scheduledCalls } = buildCtx();

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
    },
    stepIndex: 0,
    previousAssistantContent: "Prior answer",
  });

  assert.equal(actionCalls.length, 1);
  assert.equal(mutationCalls[0]?.args.modelId, "anthropic/claude-4");
  assert.match(mutationCalls[0]?.args.content as string, /\[Knowledge Base Context\]/);
  assert.match(mutationCalls[0]?.args.content as string, /\[Previous Step Output\]/);
  assert.equal(scheduledCalls.length, 1);
  assert.equal(scheduledCalls[0]?.args.complexity, 2);
  assert.equal(scheduledCalls[0]?.args.personaId, "persona_1");
});

test("enqueueStep routes research mode through the paper pipeline", async () => {
  const { ctx, scheduledCalls } = buildCtx();

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
    },
    stepIndex: 1,
  });

  assert.equal(scheduledCalls.length, 1);
  assert.equal(scheduledCalls[0]?.args.complexity, 3);
});
