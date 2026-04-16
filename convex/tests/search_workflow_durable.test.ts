import assert from "node:assert/strict";
import test from "node:test";

import {
  reconstructSearchResults,
  readQueriesFromPhase,
  handlePhaseError,
  runPlanningAction,
  runInitialSearchAction,
  runAnalysisAction,
  runDepthSearchAction,
  runSynthesisAction,
  runPaperHandoffAction,
} from "../search/workflow_durable";
import { GenerationCancelledError } from "../chat/generation_helpers";
import { SearchResult } from "../search/helpers";

// -- Test helpers -------------------------------------------------------------

const FN_NAME = Symbol.for("functionName");

/** Extract the Convex function name from a function reference. */
function fnName(fn: unknown): string {
  return (fn as Record<symbol, string>)?.[FN_NAME] ?? "";
}

/** Build a minimal fake ActionCtx with a controllable searchPhases store. */
function buildFakeCtx(options: {
  phases?: Array<{ phaseType: string; phaseOrder: number; iteration?: number; data: unknown }>;
  sessionStatus?: string;
  apiKey?: string;
  onSchedule?: (fn: unknown, args: unknown) => void;
  onMutation?: (fn: unknown, args: unknown) => void;
}) {
  const scheduled: Array<{ fn: unknown; args: unknown }> = [];
  const mutations: Array<{ fn: unknown; args: unknown }> = [];

  const phaseDocs = (options.phases ?? []).map((p, i) => ({
    _id: `phase_${i}`,
    sessionId: "session_1",
    ...p,
    status: "completed",
    startedAt: Date.now(),
    completedAt: Date.now(),
  }));

  return {
    ctx: {
      runQuery: async (fn: unknown, _args: Record<string, unknown>) => {
        const name = fnName(fn);
        if (name.includes("getSearchSession")) {
          return { status: options.sessionStatus ?? "searching" };
        }
        if (name.includes("getSearchPhases")) {
          return phaseDocs;
        }
        if (name.includes("getUserApiKey")) {
          return options.apiKey ?? "sk-test";
        }
        if (name.includes("getPersona")) {
          return null;
        }
        // Fallback for standalone helper tests that don't use real references
        if ("personaId" in _args) return null;
        if ("userId" in _args && !("sessionId" in _args)) return options.apiKey ?? "sk-test";
        if ("sessionId" in _args) return phaseDocs;
        return null;
      },
      runMutation: async (fn: unknown, args: unknown) => {
        mutations.push({ fn, args });
        options.onMutation?.(fn, args);
      },
      scheduler: {
        runAfter: async (_delay: number, fn: unknown, args: unknown) => {
          scheduled.push({ fn, args });
          options.onSchedule?.(fn, args);
        },
      },
    } as any,
    scheduled,
    mutations,
  };
}

function buildBaseArgs(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "session_1",
    assistantMessageId: "assistant_1",
    jobId: "job_1",
    chatId: "chat_1",
    userMessageId: "user_message_1",
    userId: "user_1",
    query: "AI market trends 2025",
    complexity: 1,
    expandMultiModelGroups: false,
    modelId: "openai/gpt-5.2",
    phaseOrder: 0,
    ...overrides,
  } as any;
}

function buildSearchResult(query: string, citations: string[] = []): SearchResult {
  return {
    query,
    content: `Research content for: ${query}`,
    citations,
    success: true,
    usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300, cost: 0.01 },
    generationId: "gen_123",
  };
}

// -- reconstructSearchResults -------------------------------------------------

test("reconstructSearchResults collects results from initial_search and depth_iteration phases", async () => {
  const initialResults = [
    buildSearchResult("query 1", ["https://source1.com"]),
    buildSearchResult("query 2", ["https://source2.com", "https://source2b.com"]),
  ];
  const depthResults = [
    buildSearchResult("depth query 1", ["https://deep1.com"]),
  ];

  const { ctx } = buildFakeCtx({
    phases: [
      { phaseType: "planning", phaseOrder: 0, data: { plan: "test", queries: ["q1"] } },
      { phaseType: "initial_search", phaseOrder: 1, data: { results: initialResults } },
      { phaseType: "analysis", phaseOrder: 2, iteration: 0, data: { gaps: "gap", queries: ["dq1"] } },
      { phaseType: "depth_iteration", phaseOrder: 3, iteration: 0, data: { results: depthResults } },
      { phaseType: "synthesis", phaseOrder: 4, data: "Synthesis text" },
    ],
  });

  const results = await reconstructSearchResults(ctx, "session_1" as any);

  assert.equal(results.length, 3);
  assert.equal(results[0].query, "query 1");
  assert.deepEqual(results[0].citations, ["https://source1.com"]);
  assert.equal(results[1].query, "query 2");
  assert.deepEqual(results[1].citations, ["https://source2.com", "https://source2b.com"]);
  assert.equal(results[2].query, "depth query 1");
  assert.deepEqual(results[2].citations, ["https://deep1.com"]);
});

test("reconstructSearchResults returns empty array when no search phases exist", async () => {
  const { ctx } = buildFakeCtx({
    phases: [
      { phaseType: "planning", phaseOrder: 0, data: { plan: "test", queries: ["q1"] } },
    ],
  });

  const results = await reconstructSearchResults(ctx, "session_1" as any);
  assert.equal(results.length, 0);
});

test("reconstructSearchResults preserves full SearchResult shape including usage and generationId", async () => {
  const result = buildSearchResult("test query", ["https://cite.com"]);
  const { ctx } = buildFakeCtx({
    phases: [
      { phaseType: "initial_search", phaseOrder: 0, data: { results: [result] } },
    ],
  });

  const results = await reconstructSearchResults(ctx, "session_1" as any);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].usage, { promptTokens: 100, completionTokens: 200, totalTokens: 300, cost: 0.01 });
  assert.equal(results[0].generationId, "gen_123");
  assert.equal(results[0].content, "Research content for: test query");
});

test("reconstructSearchResults handles phases with missing or malformed data gracefully", async () => {
  const { ctx } = buildFakeCtx({
    phases: [
      { phaseType: "initial_search", phaseOrder: 0, data: {} },
      { phaseType: "initial_search", phaseOrder: 1, data: { results: "not an array" } },
      { phaseType: "depth_iteration", phaseOrder: 2, iteration: 0, data: null },
    ],
  });

  const results = await reconstructSearchResults(ctx, "session_1" as any);
  assert.equal(results.length, 0);
});

// -- readQueriesFromPhase -----------------------------------------------------

test("readQueriesFromPhase reads queries from planning phase", async () => {
  const { ctx } = buildFakeCtx({
    phases: [
      { phaseType: "planning", phaseOrder: 0, data: { plan: "Research plan", queries: ["q1", "q2", "q3"] } },
    ],
  });

  const queries = await readQueriesFromPhase(ctx, "session_1" as any, "planning");
  assert.deepEqual(queries, ["q1", "q2", "q3"]);
});

test("readQueriesFromPhase reads queries from analysis phase matching iteration", async () => {
  const { ctx } = buildFakeCtx({
    phases: [
      { phaseType: "analysis", phaseOrder: 2, iteration: 0, data: { gaps: "gap0", queries: ["iter0_q1"] } },
      { phaseType: "analysis", phaseOrder: 5, iteration: 1, data: { gaps: "gap1", queries: ["iter1_q1", "iter1_q2"] } },
    ],
  });

  const iter0 = await readQueriesFromPhase(ctx, "session_1" as any, "analysis", 0);
  assert.deepEqual(iter0, ["iter0_q1"]);

  const iter1 = await readQueriesFromPhase(ctx, "session_1" as any, "analysis", 1);
  assert.deepEqual(iter1, ["iter1_q1", "iter1_q2"]);
});

test("readQueriesFromPhase returns empty array when no matching phase exists", async () => {
  const { ctx } = buildFakeCtx({ phases: [] });

  const queries = await readQueriesFromPhase(ctx, "session_1" as any, "planning");
  assert.deepEqual(queries, []);
});

// -- handlePhaseError ---------------------------------------------------------

test("handlePhaseError finalizes with failed status on regular errors", async () => {
  const { ctx, mutations } = buildFakeCtx({});
  const args = buildBaseArgs();

  await handlePhaseError(ctx, args, new Error("Perplexity API timeout"));

  const finalize = mutations.find((m) =>
    (m.args as Record<string, unknown>).status === "failed",
  );
  assert.ok(finalize);
  assert.match(
    (finalize.args as Record<string, unknown>).content as string,
    /Perplexity API timeout/,
  );
  assert.match(
    (finalize.args as Record<string, unknown>).error as string,
    /Perplexity API timeout/,
  );
});

test("handlePhaseError finalizes with cancelled status on GenerationCancelledError", async () => {
  const { ctx, mutations } = buildFakeCtx({});
  const args = buildBaseArgs();

  await handlePhaseError(ctx, args, new GenerationCancelledError());

  const finalize = mutations.find((m) =>
    (m.args as Record<string, unknown>).status === "cancelled",
  );
  assert.ok(finalize);
  assert.equal(
    (finalize.args as Record<string, unknown>).content,
    "[Research paper cancelled]",
  );

  // Session should also be marked cancelled
  const sessionPatch = mutations.find((m) => {
    const a = m.args as Record<string, unknown>;
    return (a.patch as Record<string, unknown> | undefined)?.status === "cancelled";
  });
  assert.ok(sessionPatch);
});

test("handlePhaseError handles non-Error thrown values gracefully", async () => {
  const { ctx, mutations } = buildFakeCtx({});
  const args = buildBaseArgs();

  await handlePhaseError(ctx, args, "string error");

  const finalize = mutations.find((m) =>
    (m.args as Record<string, unknown>).status === "failed",
  );
  assert.ok(finalize);
  assert.match(
    (finalize.args as Record<string, unknown>).error as string,
    /Unknown research paper error/,
  );
});

// -- Phase action chaining ----------------------------------------------------

test("runPlanningAction calls handlePhaseError on LLM failure (does not schedule next phase)", async () => {
  // runPlanningPhase calls callOpenRouterNonStreaming which will fail in test.
  // Verify that the error is caught and finalized properly.
  const { ctx, mutations, scheduled } = buildFakeCtx({
    phases: [],
    apiKey: "sk-test",
  });

  await (runPlanningAction as any)._handler(ctx, buildBaseArgs({ complexity: 1 }));

  // Should have called finalizeGeneration with failed status
  const failMutation = mutations.find((m) =>
    (m.args as Record<string, unknown>).status === "failed",
  );
  assert.ok(failMutation, "should finalize with failed on LLM error");

  // Should NOT have scheduled the next phase
  const nextPhaseScheduled = scheduled.some((s) =>
    (s.args as Record<string, unknown>).phaseOrder === 1,
  );
  assert.equal(nextPhaseScheduled, false, "should not schedule next phase on error");
});

test("runInitialSearchAction schedules synthesis for complexity 1 (depth=1, no depth loop)", async () => {
  const { ctx, scheduled } = buildFakeCtx({
    phases: [
      { phaseType: "planning", phaseOrder: 0, data: { queries: ["q1", "q2"] } },
    ],
    apiKey: "sk-test",
  });

  await (runInitialSearchAction as any)._handler(ctx, buildBaseArgs({ complexity: 1, phaseOrder: 1 }));

  // complexity 1 → depth=1 → depthIterations=0 → should skip to synthesis
  const lastScheduled = scheduled[scheduled.length - 1];
  assert.ok(lastScheduled);
  // phaseOrder should be incremented
  assert.equal((lastScheduled.args as Record<string, unknown>).phaseOrder, 2);
});

test("runInitialSearchAction schedules analysis for complexity 2 (depth=2, enters depth loop)", async () => {
  const { ctx, scheduled } = buildFakeCtx({
    phases: [
      { phaseType: "planning", phaseOrder: 0, data: { queries: ["q1", "q2", "q3"] } },
    ],
    apiKey: "sk-test",
  });

  await (runInitialSearchAction as any)._handler(ctx, buildBaseArgs({ complexity: 2, phaseOrder: 1 }));

  const lastScheduled = scheduled[scheduled.length - 1];
  assert.ok(lastScheduled);
  assert.equal((lastScheduled.args as Record<string, unknown>).depthIteration, 0);
  assert.equal((lastScheduled.args as Record<string, unknown>).phaseOrder, 2);
});

test("runDepthSearchAction schedules synthesis when depth loop is exhausted", async () => {
  const analysisResults = [buildSearchResult("analysis q", ["https://a.com"])];
  const { ctx, scheduled } = buildFakeCtx({
    phases: [
      { phaseType: "initial_search", phaseOrder: 1, data: { results: [buildSearchResult("q1", ["https://s.com"])] } },
      { phaseType: "analysis", phaseOrder: 2, iteration: 0, data: { queries: ["depth q1"] } },
    ],
    apiKey: "sk-test",
  });

  // complexity 2 → depth=2 → depthIterations=1 → iteration 0 is the last
  await (runDepthSearchAction as any)._handler(ctx, buildBaseArgs({
    complexity: 2,
    phaseOrder: 3,
    depthIteration: 0,
  }));

  // Should schedule synthesis (not another analysis)
  const lastScheduled = scheduled[scheduled.length - 1];
  assert.ok(lastScheduled);
  assert.equal((lastScheduled.args as Record<string, unknown>).phaseOrder, 4);
  // No depthIteration in synthesis args
});

test("runDepthSearchAction schedules next analysis when more depth iterations remain", async () => {
  const { ctx, scheduled } = buildFakeCtx({
    phases: [
      { phaseType: "initial_search", phaseOrder: 1, data: { results: [buildSearchResult("q1", [])] } },
      { phaseType: "analysis", phaseOrder: 2, iteration: 0, data: { queries: ["depth q1"] } },
    ],
    apiKey: "sk-test",
  });

  // complexity 3 → depth=3 → depthIterations=2 → iteration 0, more remain
  await (runDepthSearchAction as any)._handler(ctx, buildBaseArgs({
    complexity: 3,
    phaseOrder: 3,
    depthIteration: 0,
  }));

  const lastScheduled = scheduled[scheduled.length - 1];
  assert.ok(lastScheduled);
  assert.equal((lastScheduled.args as Record<string, unknown>).depthIteration, 1);
});

test("runSynthesisAction calls handlePhaseError on LLM failure (does not schedule next phase)", async () => {
  // runSynthesisPhase calls callOpenRouterNonStreaming which will fail in test.
  const { ctx, mutations, scheduled } = buildFakeCtx({
    phases: [
      { phaseType: "initial_search", phaseOrder: 1, data: { results: [buildSearchResult("q1", ["https://s.com"])] } },
    ],
    apiKey: "sk-test",
  });

  await (runSynthesisAction as any)._handler(ctx, buildBaseArgs({ phaseOrder: 4 }));

  // Should have called finalizeGeneration with failed status
  const failMutation = mutations.find((m) =>
    (m.args as Record<string, unknown>).status === "failed",
  );
  assert.ok(failMutation, "should finalize with failed on LLM error");

  // Should NOT have scheduled paper handoff
  const handoffScheduled = scheduled.some((s) =>
    (s.args as Record<string, unknown>).phaseOrder === 5,
  );
  assert.equal(handoffScheduled, false, "should not schedule paper handoff on error");
});

// -- Paper handoff: citations preserved end-to-end ----------------------------

test("runPaperHandoffAction persists searchContext with full citations from all phases", async () => {
  const initialResults = [
    buildSearchResult("initial q1", ["https://source1.com", "https://source1b.com"]),
    buildSearchResult("initial q2", ["https://source2.com"]),
  ];
  const depthResults = [
    buildSearchResult("depth q1", ["https://deep1.com", "https://deep1b.com", "https://deep1c.com"]),
  ];

  const { ctx, mutations, scheduled } = buildFakeCtx({
    phases: [
      { phaseType: "initial_search", phaseOrder: 1, data: { results: initialResults } },
      { phaseType: "depth_iteration", phaseOrder: 3, iteration: 0, data: { results: depthResults } },
      { phaseType: "synthesis", phaseOrder: 4, data: JSON.stringify({ findings: "Key findings", sources: ["s1"] }) },
    ],
    apiKey: "sk-test",
  });

  await (runPaperHandoffAction as any)._handler(ctx, buildBaseArgs({ phaseOrder: 5 }));

  // Find the patchMessageSearchContext mutation
  const searchContextMutation = mutations.find((m) => {
    const a = m.args as Record<string, unknown>;
    return a.mode === "paper" && a.searchContext !== undefined;
  });
  assert.ok(searchContextMutation, "searchContext mutation should be called");

  const searchContext = (searchContextMutation.args as Record<string, unknown>).searchContext as {
    complexity: number;
    queries: string[];
    searchResults: SearchResult[];
  };

  // All 3 results preserved
  assert.equal(searchContext.searchResults.length, 3);

  // Citations fully preserved
  assert.deepEqual(searchContext.searchResults[0].citations, ["https://source1.com", "https://source1b.com"]);
  assert.deepEqual(searchContext.searchResults[1].citations, ["https://source2.com"]);
  assert.deepEqual(searchContext.searchResults[2].citations, ["https://deep1.com", "https://deep1b.com", "https://deep1c.com"]);

  // Queries list matches
  assert.deepEqual(searchContext.queries, ["initial q1", "initial q2", "depth q1"]);

  // Content preserved
  assert.equal(searchContext.searchResults[0].content, "Research content for: initial q1");
  assert.equal(searchContext.searchResults[2].content, "Research content for: depth q1");
});

test("runPaperHandoffAction reads synthesis data from persisted phase", async () => {
  const synthesisJson = JSON.stringify({
    findings: "AI is growing rapidly",
    sources: ["https://report.com"],
    recommendations: ["Invest early"],
  });

  const { ctx, scheduled } = buildFakeCtx({
    phases: [
      { phaseType: "initial_search", phaseOrder: 1, data: { results: [buildSearchResult("q1", [])] } },
      { phaseType: "synthesis", phaseOrder: 2, data: synthesisJson },
    ],
    apiKey: "sk-test",
  });

  await (runPaperHandoffAction as any)._handler(ctx, buildBaseArgs({ phaseOrder: 3 }));

  // Should have scheduled runGeneration via runPaperGenerationPhase
  // The scheduled call's participants should contain the synthesis data in the system prompt
  const runGenCall = scheduled.find((s) => {
    const a = s.args as Record<string, unknown>;
    return Array.isArray(a.participants);
  });
  assert.ok(runGenCall, "runGeneration should be scheduled");

  const participants = (runGenCall.args as Record<string, unknown>).participants as Array<{ systemPrompt?: string }>;
  assert.ok(participants[0]?.systemPrompt);
  assert.match(participants[0].systemPrompt, /AI is growing rapidly/);
});

test("runPaperHandoffAction throws when no synthesis phase exists", async () => {
  const { ctx, mutations } = buildFakeCtx({
    phases: [
      { phaseType: "initial_search", phaseOrder: 1, data: { results: [] } },
      // No synthesis phase
    ],
    apiKey: "sk-test",
  });

  await (runPaperHandoffAction as any)._handler(ctx, buildBaseArgs({ phaseOrder: 3 }));

  // Should have called handlePhaseError → finalize with failed
  const failMutation = mutations.find((m) =>
    (m.args as Record<string, unknown>).status === "failed",
  );
  assert.ok(failMutation);
  assert.match(
    (failMutation.args as Record<string, unknown>).error as string,
    /No synthesis phase found/,
  );
});

// -- Cancellation propagation across phases -----------------------------------

test("phase actions finalize with cancelled status when session is cancelled", async () => {
  const { ctx, mutations } = buildFakeCtx({
    phases: [],
    sessionStatus: "cancelled",
    apiKey: "sk-test",
  });

  await (runPlanningAction as any)._handler(ctx, buildBaseArgs());

  const cancelMutation = mutations.find((m) =>
    (m.args as Record<string, unknown>).status === "cancelled",
  );
  assert.ok(cancelMutation);
  assert.equal(
    (cancelMutation.args as Record<string, unknown>).content,
    "[Research paper cancelled]",
  );
});

// -- Entry point (workflow.ts) schedules durable planning ---------------------

test("researchPaperPipeline entry point schedules runPlanningAction with phaseOrder 0", async () => {
  // Import the entry point
  const { researchPaperPipeline } = await import("../search/workflow");

  const scheduled: Array<{ args: unknown }> = [];

  await (researchPaperPipeline as any)._handler({
    runMutation: async () => undefined,
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("userId" in args) return "sk-test";
      if ("sessionId" in args) return { status: "searching" };
      return null;
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, args: unknown) => {
        scheduled.push({ args });
      },
    },
  }, {
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
  });

  assert.equal(scheduled.length, 1);
  assert.equal((scheduled[0].args as Record<string, unknown>).phaseOrder, 0);
  assert.equal((scheduled[0].args as Record<string, unknown>).complexity, 2);
  assert.equal((scheduled[0].args as Record<string, unknown>).query, "AI pricing");
});

test("researchPaperPipeline entry point fails fast when API key is missing", async () => {
  const { researchPaperPipeline } = await import("../search/workflow");

  const mutations: Array<{ args: Record<string, unknown> }> = [];

  await (researchPaperPipeline as any)._handler({
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      mutations.push({ args });
    },
    runQuery: async () => null, // No API key
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
    query: "test",
    complexity: 1,
    expandMultiModelGroups: false,
    modelId: "openai/gpt-5.2",
  });

  assert.ok(mutations.some((m) => m.args.status === "failed"));
  assert.ok(mutations.some((m) =>
    typeof m.args.error === "string" && /MISSING_API_KEY/.test(m.args.error),
  ));
});
