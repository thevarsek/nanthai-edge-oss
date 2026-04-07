import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
  runAnalysisPhase,
  runDepthSearchPhase,
  runInitialSearchPhase,
  runPlanningPhase,
  runSynthesisPhase,
  workflowNonstreamDeps,
} from "../search/workflow_nonstream_phases";
import { createMockCtx } from "./helpers/mock_ctx";

function buildArgs() {
  return {
    sessionId: "session_1",
    chatId: "chat_1",
    assistantMessageId: "msg_assistant",
    userMessageId: "msg_user",
    userId: "user_1",
    query: "What changed in Swift concurrency?",
    complexity: 2,
    modelId: "openai/gpt-5",
    apiKey: "key",
    personaId: undefined,
    systemPrompt: undefined,
    temperature: 0.5,
    maxTokens: 1200,
    expandMultiModelGroups: false,
  } as any;
}

test("runPlanningPhase falls back to the raw query when orchestration JSON is invalid", async (t) => {
  t.after(() => {
    mock.restoreAll();
  });

  const updateCalls: Record<string, unknown>[] = [];
  const mutationCalls: Record<string, unknown>[] = [];
  const ancillaryCalls: Record<string, unknown>[] = [];

  mock.method(
    workflowNonstreamDeps,
    "updateSession",
    async (_ctx: unknown, _id: unknown, patch: unknown) => {
      updateCalls.push(patch as Record<string, unknown>);
    },
  );
  mock.method(workflowNonstreamDeps, "callOpenRouterNonStreaming", async () => ({
    content: "not valid json",
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cost: 0.12,
    },
    finishReason: "stop",
    audioBase64: "",
    audioTranscript: "",
    generationId: "gen_1",
  }));

  const ctx = createMockCtx({
    runQuery: async () => null,
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        ancillaryCalls.push(args);
      },
    },
  });

  const result = await runPlanningPhase(ctx, buildArgs(), 3, 1);

  assert.equal(updateCalls[0]?.status, "planning");
  assert.deepEqual(result, {
    plan: "Direct research on: What changed in Swift concurrency?",
    queries: ["What changed in Swift concurrency?"],
  });
  assert.equal(mutationCalls[0]?.phaseType, "planning");
  assert.equal(ancillaryCalls[0]?.source, "search_planning");
});

test("runInitialSearchPhase and runDepthSearchPhase persist results and track search costs", async (t) => {
  t.after(() => {
    mock.restoreAll();
  });

  const updates: Record<string, unknown>[] = [];
  const trackCalls: Record<string, unknown>[] = [];
  const writes: Record<string, unknown>[] = [];

  mock.method(
    workflowNonstreamDeps,
    "updateSession",
    async (_ctx: unknown, _id: unknown, patch: unknown) => {
      updates.push(patch as Record<string, unknown>);
    },
  );
  mock.method(workflowNonstreamDeps, "executePerplexitySearch", async (queries: unknown) =>
    (queries as string[]).map((query) => ({
      query,
      success: true,
      content: `result:${query}`,
      citations: ["https://example.com"],
    })),
  );
  mock.method(
    workflowNonstreamDeps,
    "trackPerplexitySearchCosts",
    async (_ctx: unknown, results: unknown, meta: unknown) => {
      trackCalls.push({
        count: (results as unknown[]).length,
        ...(meta as Record<string, unknown>),
      });
    },
  );

  const ctx = createMockCtx({
    runQuery: async () => null,
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      writes.push(args);
    },
    scheduler: { runAfter: async () => undefined },
  });

  const initial = await runInitialSearchPhase(
    ctx,
    buildArgs(),
    ["swift actors"],
    "perplexity/sonar",
    2,
  );
  const depth = await runDepthSearchPhase(
    ctx,
    buildArgs(),
    ["swift isolated"],
    "perplexity/sonar",
    3,
    1,
  );

  assert.equal(initial[0]?.query, "swift actors");
  assert.equal(depth[0]?.query, "swift isolated");
  assert.equal(updates[0]?.status, "searching");
  assert.equal(updates[1]?.status, "deepening");
  assert.equal(trackCalls.length, 2);
  assert.equal(writes[0]?.phaseType, "initial_search");
  assert.equal(writes[1]?.phaseType, "depth_iteration");
});

test("runAnalysisPhase uses persona system prompts and falls back when JSON parsing fails", async (t) => {
  t.after(() => {
    mock.restoreAll();
  });

  const updates: Record<string, unknown>[] = [];
  const writes: Record<string, unknown>[] = [];
  let capturedMessages: Array<{ role: string; content: string }> = [];

  mock.method(
    workflowNonstreamDeps,
    "updateSession",
    async (_ctx: unknown, _id: unknown, patch: unknown) => {
      updates.push(patch as Record<string, unknown>);
    },
  );
  mock.method(
    workflowNonstreamDeps,
    "callOpenRouterNonStreaming",
    async (_apiKey: unknown, _modelId: unknown, messages: unknown) => {
      capturedMessages = messages as Array<{ role: string; content: string }>;
      return {
        content: "still not json",
        usage: null,
        finishReason: "stop",
        audioBase64: "",
        audioTranscript: "",
        generationId: null,
      };
    },
  );

  const ctx = createMockCtx({
    runQuery: async () => ({
      systemPrompt: "Persona system prompt",
    }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      writes.push(args);
    },
    scheduler: { runAfter: async () => undefined },
  });

  const result = await runAnalysisPhase(
    ctx,
    {
      ...buildArgs(),
      personaId: "persona_1",
    },
    [{ query: "swift", success: true, content: "info", citations: [] }],
    2,
    4,
    1,
  );

  assert.equal(updates[0]?.status, "analyzing");
  assert.equal(capturedMessages[0]?.role, "system");
  assert.equal(capturedMessages[0]?.content, "Persona system prompt");
  assert.deepEqual(result, {
    gaps: "Could not parse gap analysis; performing general follow-up search.",
    queries: ["More details about: What changed in Swift concurrency?"],
  });
  assert.equal(writes[0]?.phaseType, "analysis");
});

test("runSynthesisPhase serializes parsed JSON or falls back when output is empty", async (t) => {
  t.after(() => {
    mock.restoreAll();
  });

  const updates: Record<string, unknown>[] = [];
  const writes: Record<string, unknown>[] = [];
  const ancillaryCalls: Record<string, unknown>[] = [];

  mock.method(
    workflowNonstreamDeps,
    "updateSession",
    async (_ctx: unknown, _id: unknown, patch: unknown) => {
      updates.push(patch as Record<string, unknown>);
    },
  );
  mock.method(workflowNonstreamDeps, "callOpenRouterNonStreaming", async () => ({
    content: "{\"findings\":\"Done\",\"sources\":[\"https://example.com\"]}",
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cost: 0.2,
    },
    finishReason: "stop",
    audioBase64: "",
    audioTranscript: "",
    generationId: "gen_synth",
  }));

  const ctx = createMockCtx({
    runQuery: async () => null,
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      writes.push(args);
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        ancillaryCalls.push(args);
      },
    },
  });

  const result = await runSynthesisPhase(
    ctx,
    buildArgs(),
    [
      {
        query: "swift actors",
        success: true,
        content: "Actor guidance",
        citations: ["https://example.com/actor"],
      },
    ],
    5,
  );

  assert.equal(updates[0]?.status, "synthesizing");
  assert.equal(result, "{\"findings\":\"Done\",\"sources\":[\"https://example.com\"]}");
  assert.equal(writes[0]?.phaseType, "synthesis");
  assert.equal(ancillaryCalls[0]?.source, "search_synthesis");
});
