import assert from "node:assert/strict";
import test from "node:test";

import { GenerationCancelledError } from "../chat/generation_helpers";
import {
  buildPaperGenerationSystemPrompt,
  buildResearchAnalysisPrompt,
  buildResearchPlanningPrompt,
  buildResearchSynthesisPrompt,
  buildSearchSynthesisPrompt,
  resolveComplexityPreset,
} from "../search/helpers";
import {
  buildQueryGenerationPrompt,
  parseGeneratedQueries,
} from "../search/query_generation_helpers";
import { researchPaperPipeline } from "../search/workflow";
import { checkCancellation, computeProgress } from "../search/workflow_shared";
import { runPaperGenerationPhase } from "../search/workflow_paper_phase";

test("query generation helpers build prompts and normalize generated query lists", () => {
  const prompt = buildQueryGenerationPrompt("AI pricing", 3);
  const fromJson = parseGeneratedQueries(
    '["AI pricing latest", "AI pricing latest", "enterprise AI pricing"]',
    "AI pricing",
    3,
  );
  const fromLines = parseGeneratedQueries(
    "1. Short\n2. Enterprise AI pricing models\n3. Practical AI pricing examples",
    "AI pricing",
    3,
  );
  const fallback = parseGeneratedQueries("n/a", "AI pricing", 3);

  assert.match(prompt, /Generate exactly 3 diverse search queries/);
  assert.deepEqual(fromJson, [
    "AI pricing latest",
    "enterprise AI pricing",
    "AI pricing latest developments",
  ]);
  assert.deepEqual(fromLines, [
    "Enterprise AI pricing models",
    "Practical AI pricing examples",
    "AI pricing latest developments",
  ]);
  assert.deepEqual(fallback, [
    "AI pricing",
    "AI pricing latest developments",
    "AI pricing expert analysis",
  ]);
});

test("search helper prompts cover successful and empty search contexts", () => {
  const synthesisPrompt = buildSearchSynthesisPrompt([
    {
      query: "AI pricing",
      content: "Result body",
      citations: ["https://example.com/source"],
      success: true,
    },
  ]);

  assert.match(synthesisPrompt, /<search_results>/);
  assert.match(synthesisPrompt, /\[1\] https:\/\/example.com\/source/);
  assert.match(buildSearchSynthesisPrompt([]), /No search results were found/);
  assert.match(buildResearchPlanningPrompt("AI pricing", 2), /generate 2 diverse, specific search queries/i);
  assert.match(buildResearchAnalysisPrompt("Prior result", 4), /Generate 4 follow-up search queries/i);
  assert.match(buildResearchSynthesisPrompt("All results"), /structured research summary/i);
  assert.match(buildPaperGenerationSystemPrompt("Synthesis"), /executive summary/i);
  assert.equal(resolveComplexityPreset("paper", 99).depth, 3);
});

test("workflow shared helpers compute progress and throw on cancelled sessions", async () => {
  assert.equal(computeProgress(1, "planning", 0), 25);
  assert.equal(computeProgress(2, "depth_iteration", 0), 55);
  assert.equal(computeProgress(3, "analysis", 1), 54);

  await assert.rejects(
    checkCancellation({
      runQuery: async () => ({ status: "cancelled" }),
    } as any, "session_1" as any),
    (error: unknown) => error instanceof GenerationCancelledError,
  );
});

test("runPaperGenerationPhase schedules runGeneration with persona or explicit system prompt context", async () => {
  const scheduled: Array<Record<string, unknown>> = [];

  await runPaperGenerationPhase({
    runMutation: async () => undefined,
    runQuery: async (_fn: unknown, args: Record<string, unknown>) =>
      args.personaId ? { systemPrompt: "Persona voice" } : null,
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
  } as any, {
    sessionId: "session_1",
    assistantMessageId: "assistant_1",
    jobId: "job_1",
    chatId: "chat_1",
    userMessageId: "user_message_1",
    userId: "user_1",
    query: "AI pricing",
    complexity: 2,
    expandMultiModelGroups: false,
    modelId: "openai/gpt-5.2",
    personaId: "persona_1",
  } as any, "Research synthesis", 4);

  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]?.webSearchEnabled, false);
  const participants = (scheduled[0]?.participants ?? []) as Array<{ systemPrompt?: string }>;
  assert.match(String(participants[0]?.systemPrompt ?? ""), /Persona voice/);
  assert.match(String(participants[0]?.systemPrompt ?? ""), /Research synthesis/);
});

test("researchPaperPipeline finalizes cancelled sessions cleanly", async () => {
  const mutations: Array<{ args: Record<string, unknown> }> = [];

  await (researchPaperPipeline as any)._handler({
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      mutations.push({ args });
    },
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("userId" in args) return "sk-test";
      if ("sessionId" in args) return { status: "cancelled" };
      return null;
    },
    scheduler: {
      runAfter: async () => undefined,
    },
  }, {
    sessionId: "session_1",
    assistantMessageId: "assistant_1",
    jobId: "job_1",
    chatId: "chat_1",
    userMessageId: "user_message_1",
    userId: "user_1",
    query: "AI pricing",
    complexity: 1,
    expandMultiModelGroups: false,
    modelId: "openai/gpt-5.2",
  });

  assert.ok(mutations.some((entry) => entry.args.status === "streaming"));
  assert.ok(mutations.some((entry) => entry.args.status === "cancelled"));
  assert.ok(
    mutations.some((entry) =>
      typeof entry.args.content === "string" && /cancelled/i.test(entry.args.content),
    ),
  );
  assert.ok(
    mutations.some((entry) =>
      (entry.args.patch as Record<string, unknown> | undefined)?.status === "cancelled",
    ),
  );
});

test("researchPaperPipeline finalizes failures when required API key is missing", async () => {
  const mutations: Array<{ args: Record<string, unknown> }> = [];

  await (researchPaperPipeline as any)._handler({
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      mutations.push({ args });
    },
    runQuery: async () => null,
    scheduler: {
      runAfter: async () => undefined,
    },
  }, {
    sessionId: "session_1",
    assistantMessageId: "assistant_1",
    jobId: "job_1",
    chatId: "chat_1",
    userMessageId: "user_message_1",
    userId: "user_1",
    query: "AI pricing",
    complexity: 1,
    expandMultiModelGroups: false,
    modelId: "openai/gpt-5.2",
  });

  assert.ok(mutations.some((entry) => entry.args.status === "streaming"));
  assert.ok(mutations.some((entry) => entry.args.status === "failed"));
  assert.ok(
    mutations.some((entry) =>
      typeof entry.args.error === "string" && /MISSING_API_KEY/.test(entry.args.error),
    ),
  );
  assert.ok(
    mutations.some((entry) =>
      (entry.args.patch as Record<string, unknown> | undefined)?.status === "failed",
    ),
  );
});
