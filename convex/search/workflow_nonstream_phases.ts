import { internal } from "../_generated/api";
import { ActionCtx } from "../_generated/server";
import { callOpenRouterNonStreaming } from "../lib/openrouter";
import {
  buildResearchPlanningPrompt,
  buildResearchAnalysisPrompt,
  buildResearchSynthesisPrompt,
  buildPaperArchitecturePrompt,
  executePerplexitySearch,
  parseAnalysisArtifact,
  parsePlanningArtifact,
  parseStructuredArtifact,
  resolveSearchMaxTokens,
  SEARCH_TRANSFORMS,
  SearchResult,
  summarizeSearchResults,
} from "./helpers";
import { MODEL_IDS } from "../lib/model_constants";
import { withZdrProvider } from "../lib/openrouter_zdr";
import {
  checkCancellation,
  computeProgress,
  PipelineArgs,
  updateSession,
} from "./workflow_shared";
import { trackPerplexitySearchCosts } from "./actions_web_search_shared";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";
import {
  captureBackendAIOperationCompleted,
  captureBackendAIOperationFailed,
  captureBackendAIOperationStarted,
} from "../analytics/backend_events";
import type { OpenRouterUsage } from "../lib/openrouter";
import {
  buildResearchTemporalContext,
  normalizeResearchQueryForTime,
} from "./research_temporal";

type PipelineArgsWithApiKey = PipelineArgs & {
  apiKey: string;
  requireZdr?: boolean;
};

const defaultWorkflowNonstreamDeps = {
  callOpenRouterNonStreaming,
  executePerplexitySearch,
  updateSession,
  trackPerplexitySearchCosts,
};

export type WorkflowNonstreamDeps = typeof defaultWorkflowNonstreamDeps;

function researchBackendAnalyticsSource(args: PipelineArgs): NonNullable<PipelineArgs["analyticsSource"]> {
  return args.analyticsSource ?? "research_paper";
}

export function createWorkflowNonstreamDepsForTest(
  overrides: DeepPartial<WorkflowNonstreamDeps> = {},
): WorkflowNonstreamDeps {
  return mergeTestDeps(defaultWorkflowNonstreamDeps, overrides);
}

interface PlanningResult {
  plan: string;
  queries: string[];
}

interface AnalysisResult {
  gaps: string;
  queries: string[];
}

type StructuredPhaseResult = string;

async function researchTemporalForSession(
  ctx: ActionCtx,
  args: PipelineArgs,
) {
  const session = await ctx.runQuery(
    internal.search.queries.getSearchSession,
    { sessionId: args.sessionId },
  );
  const startedAt = typeof session?.startedAt === "number"
    ? new Date(session.startedAt)
    : new Date();
  return buildResearchTemporalContext(args.query, startedAt);
}

function aggregateSearchUsage(results: SearchResult[]): OpenRouterUsage | null {
  const usages = results
    .map((result) => result.usage)
    .filter((usage): usage is NonNullable<SearchResult["usage"]> => Boolean(usage));
  if (usages.length === 0) return null;
  return usages.reduce<OpenRouterUsage>((total, usage) => ({
    promptTokens: total.promptTokens + usage.promptTokens,
    completionTokens: total.completionTokens + usage.completionTokens,
    totalTokens: total.totalTokens + usage.totalTokens,
    cost: (total.cost ?? 0) + (usage.cost ?? 0),
    webSearchRequests: (total.webSearchRequests ?? 0) + 1,
  }), {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
    webSearchRequests: 0,
  });
}

function researchOperationProperties(
  args: PipelineArgsWithApiKey,
  phaseOrder: number,
  extra: Record<string, string | number | boolean | null | undefined> = {},
) {
  return {
    search_session_id: String(args.sessionId),
    complexity: args.complexity,
    phase_order: phaseOrder,
    persona_used: Boolean(args.personaId),
    subagents_enabled: args.subagentsEnabled === true,
    integration_count: args.enabledIntegrations?.length ?? 0,
    zdr_required: args.requireZdr === true,
    ...extra,
  };
}

async function buildOrchestrationMessages(
  ctx: ActionCtx,
  args: PipelineArgsWithApiKey,
  prompt: string,
): Promise<Array<{ role: "system" | "user"; content: string }>> {
  let systemPrompt = args.systemPrompt;
  if (!systemPrompt && args.personaId) {
    const persona = await ctx.runQuery(internal.chat.queries.getPersona, {
      personaId: args.personaId,
      userId: args.userId,
    });
    if (persona?.systemPrompt) {
      systemPrompt = persona.systemPrompt;
    }
  }

  if (systemPrompt) {
    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ];
  }

  return [{ role: "user", content: prompt }];
}

export async function runPlanningPhase(
  ctx: ActionCtx,
  args: PipelineArgsWithApiKey,
  breadth: number,
  phaseOrder: number,
  deps: WorkflowNonstreamDeps = defaultWorkflowNonstreamDeps,
): Promise<PlanningResult> {
  await deps.updateSession(ctx, args.sessionId, {
    status: "planning",
    progress: computeProgress(args.complexity, "planning", 0),
    currentPhase: "planning",
    phaseOrder,
  }, args);

  const temporal = await researchTemporalForSession(ctx, args);
  const prompt = buildResearchPlanningPrompt(args.query, breadth, temporal);
  const messages = await buildOrchestrationMessages(ctx, args, prompt);
  const operationStartedAt = Date.now();
  await captureBackendAIOperationStarted(ctx, {
    userId: args.userId,
    operation: "research_planning",
    source: researchBackendAnalyticsSource(args),
    analytics: args.analytics,
    chatId: String(args.chatId),
    messageId: String(args.assistantMessageId),
    jobId: String(args.jobId),
    modelId: args.modelId,
    properties: researchOperationProperties(args, phaseOrder, {
      breadth,
      request_message_count: messages.length,
    }),
  });
  let result: Awaited<ReturnType<typeof deps.callOpenRouterNonStreaming>>;
  try {
    result = await deps.callOpenRouterNonStreaming(
      args.apiKey,
      args.modelId,
      messages,
      withZdrProvider(
        { temperature: 0.7, maxTokens: 4096, transforms: SEARCH_TRANSFORMS },
        args.requireZdr === true,
      ),
      { fallbackModel: MODEL_IDS.searchResearchOrchestration },
    );
  } catch (error) {
    await captureBackendAIOperationFailed(ctx, {
      userId: args.userId,
      operation: "research_planning",
      source: researchBackendAnalyticsSource(args),
      analytics: args.analytics,
      chatId: String(args.chatId),
      messageId: String(args.assistantMessageId),
      jobId: String(args.jobId),
      modelId: args.modelId,
      durationMs: Date.now() - operationStartedAt,
      error,
      properties: researchOperationProperties(args, phaseOrder, {
        breadth,
        request_message_count: messages.length,
      }),
    });
    throw error;
  }
  await checkCancellation(ctx, args.sessionId, args);

  const parsedArtifact = parsePlanningArtifact(result.content, args.query, breadth);
  const artifact = {
    ...parsedArtifact,
    researchDate: temporal.referenceDate,
    reportingWindow: temporal.recencySensitive
      ? { start: temporal.windowStart, end: temporal.windowEnd }
      : undefined,
    queries: parsedArtifact.queries.map((query) => ({
      ...query,
      query: normalizeResearchQueryForTime(query.query, temporal),
    })),
  };
  const queries = artifact.queries.map((query) => query.query);
  const plan = artifact.plan;
  await captureBackendAIOperationCompleted(ctx, {
    userId: args.userId,
    operation: "research_planning",
    source: researchBackendAnalyticsSource(args),
    analytics: args.analytics,
    chatId: String(args.chatId),
    messageId: String(args.assistantMessageId),
    jobId: String(args.jobId),
    modelId: args.modelId,
    usage: result.usage,
    durationMs: Date.now() - operationStartedAt,
    openrouterGenerationId: result.generationId,
    properties: researchOperationProperties(args, phaseOrder, {
      breadth,
      generated_query_count: queries.length,
      request_message_count: messages.length,
    }),
  });

  // M23: Track research planning cost.
  if (result.usage) {
    await ctx.scheduler.runAfter(0, internal.chat.mutations.storeAncillaryCost, {
      messageId: args.assistantMessageId,
      chatId: args.chatId,
      userId: args.userId,
      modelId: args.modelId,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      cost: result.usage.cost ?? undefined,
      source: "search_planning",
      generationId: result.generationId ?? undefined,
    });
  }

  await ctx.runMutation(internal.search.mutations.writeSearchPhase, {
    sessionId: args.sessionId,
    phaseType: "planning",
    phaseOrder,
    data: artifact,
    executionAttemptId: args.executionAttemptId,
    executionFence: args.executionFence,
  });

  return { plan, queries };
}

export async function runInitialSearchPhase(
  ctx: ActionCtx,
  args: PipelineArgsWithApiKey,
  queries: string[],
  searchModel: string,
  phaseOrder: number,
  deps: WorkflowNonstreamDeps = defaultWorkflowNonstreamDeps,
): Promise<SearchResult[]> {
  await deps.updateSession(ctx, args.sessionId, {
    status: "searching",
    progress: computeProgress(args.complexity, "initial_search", 0),
    currentPhase: "searching",
    phaseOrder,
  }, args);

  const operationStartedAt = Date.now();
  await captureBackendAIOperationStarted(ctx, {
    userId: args.userId,
    operation: "research_initial_search",
    source: researchBackendAnalyticsSource(args),
    analytics: args.analytics,
    chatId: String(args.chatId),
    messageId: String(args.assistantMessageId),
    jobId: String(args.jobId),
    modelId: searchModel,
    properties: researchOperationProperties(args, phaseOrder, {
      query_count: queries.length,
    }),
  });
  let results: SearchResult[];
  try {
    results = await deps.executePerplexitySearch(
      queries,
      searchModel,
      args.apiKey,
      {
        maxTokens: resolveSearchMaxTokens("paper", args.complexity, searchModel),
        requireZdr: args.requireZdr === true,
      },
    );
  } catch (error) {
    await captureBackendAIOperationFailed(ctx, {
      userId: args.userId,
      operation: "research_initial_search",
      source: researchBackendAnalyticsSource(args),
      analytics: args.analytics,
      chatId: String(args.chatId),
      messageId: String(args.assistantMessageId),
      jobId: String(args.jobId),
      modelId: searchModel,
      durationMs: Date.now() - operationStartedAt,
      error,
      properties: researchOperationProperties(args, phaseOrder, {
        query_count: queries.length,
      }),
    });
    throw error;
  }
  await checkCancellation(ctx, args.sessionId, args);

  await captureBackendAIOperationCompleted(ctx, {
    userId: args.userId,
    operation: "research_initial_search",
    source: researchBackendAnalyticsSource(args),
    analytics: args.analytics,
    chatId: String(args.chatId),
    messageId: String(args.assistantMessageId),
    jobId: String(args.jobId),
    modelId: searchModel,
    usage: aggregateSearchUsage(results),
    durationMs: Date.now() - operationStartedAt,
    properties: researchOperationProperties(args, phaseOrder, {
      query_count: queries.length,
      result_count: results.length,
      successful_result_count: results.filter((result) => result.success).length,
      failed_result_count: results.filter((result) => !result.success).length,
    }),
  });

  // M23: Track Perplexity search costs.
  await deps.trackPerplexitySearchCosts(ctx, results, {
    messageId: args.assistantMessageId,
    chatId: args.chatId,
    userId: args.userId,
    searchModel,
  });

  await ctx.runMutation(internal.search.mutations.writeSearchPhase, {
    sessionId: args.sessionId,
    phaseType: "initial_search",
    phaseOrder,
    data: { results },
    executionAttemptId: args.executionAttemptId,
    executionFence: args.executionFence,
  });

  return results;
}

export async function runAnalysisPhase(
  ctx: ActionCtx,
  args: PipelineArgsWithApiKey,
  priorResults: SearchResult[],
  breadth: number,
  phaseOrder: number,
  iteration: number,
  deps: WorkflowNonstreamDeps = defaultWorkflowNonstreamDeps,
): Promise<AnalysisResult> {
  await deps.updateSession(ctx, args.sessionId, {
    status: "analyzing",
    progress: computeProgress(args.complexity, "analysis", iteration),
    currentPhase: "analyzing",
    phaseOrder,
  }, args);

  const priorSummary = summarizeSearchResults(priorResults, 2000);

  const temporal = await researchTemporalForSession(ctx, args);
  const prompt = buildResearchAnalysisPrompt(priorSummary, breadth, temporal);
  const messages = await buildOrchestrationMessages(ctx, args, prompt);
  const operationStartedAt = Date.now();
  await captureBackendAIOperationStarted(ctx, {
    userId: args.userId,
    operation: "research_analysis",
    source: researchBackendAnalyticsSource(args),
    analytics: args.analytics,
    chatId: String(args.chatId),
    messageId: String(args.assistantMessageId),
    jobId: String(args.jobId),
    modelId: args.modelId,
    properties: researchOperationProperties(args, phaseOrder, {
      breadth,
      iteration,
      prior_result_count: priorResults.length,
      request_message_count: messages.length,
    }),
  });
  let result: Awaited<ReturnType<typeof deps.callOpenRouterNonStreaming>>;
  try {
    result = await deps.callOpenRouterNonStreaming(
      args.apiKey,
      args.modelId,
      messages,
      withZdrProvider(
        { temperature: 0.5, maxTokens: 4096, transforms: SEARCH_TRANSFORMS },
        args.requireZdr === true,
      ),
      { fallbackModel: MODEL_IDS.searchResearchOrchestration },
    );
  } catch (error) {
    await captureBackendAIOperationFailed(ctx, {
      userId: args.userId,
      operation: "research_analysis",
      source: researchBackendAnalyticsSource(args),
      analytics: args.analytics,
      chatId: String(args.chatId),
      messageId: String(args.assistantMessageId),
      jobId: String(args.jobId),
      modelId: args.modelId,
      durationMs: Date.now() - operationStartedAt,
      error,
      properties: researchOperationProperties(args, phaseOrder, {
        breadth,
        iteration,
        prior_result_count: priorResults.length,
        request_message_count: messages.length,
      }),
    });
    throw error;
  }
  await checkCancellation(ctx, args.sessionId, args);

  const parsedArtifact = parseAnalysisArtifact(result.content, args.query, breadth);
  const artifact = {
    ...parsedArtifact,
    researchDate: temporal.referenceDate,
    reportingWindow: temporal.recencySensitive
      ? { start: temporal.windowStart, end: temporal.windowEnd }
      : undefined,
    followUpQueries: parsedArtifact.followUpQueries.map((query) => ({
      ...query,
      query: normalizeResearchQueryForTime(query.query, temporal),
    })),
  };
  const gaps = artifact.coverageSummary;
  const queries = artifact.followUpQueries.map((query) => query.query);

  await captureBackendAIOperationCompleted(ctx, {
    userId: args.userId,
    operation: "research_analysis",
    source: researchBackendAnalyticsSource(args),
    analytics: args.analytics,
    chatId: String(args.chatId),
    messageId: String(args.assistantMessageId),
    jobId: String(args.jobId),
    modelId: args.modelId,
    usage: result.usage,
    durationMs: Date.now() - operationStartedAt,
    openrouterGenerationId: result.generationId,
    properties: researchOperationProperties(args, phaseOrder, {
      breadth,
      iteration,
      prior_result_count: priorResults.length,
      generated_query_count: queries.length,
      request_message_count: messages.length,
    }),
  });

  // M23: Track research analysis cost.
  if (result.usage) {
    await ctx.scheduler.runAfter(0, internal.chat.mutations.storeAncillaryCost, {
      messageId: args.assistantMessageId,
      chatId: args.chatId,
      userId: args.userId,
      modelId: args.modelId,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      cost: result.usage.cost ?? undefined,
      source: "search_analysis",
      generationId: result.generationId ?? undefined,
    });
  }

  await ctx.runMutation(internal.search.mutations.writeSearchPhase, {
    sessionId: args.sessionId,
    phaseType: "analysis",
    phaseOrder,
    iteration,
    data: artifact,
    executionAttemptId: args.executionAttemptId,
    executionFence: args.executionFence,
  });

  return { gaps, queries };
}

export async function runDepthSearchPhase(
  ctx: ActionCtx,
  args: PipelineArgsWithApiKey,
  queries: string[],
  searchModel: string,
  phaseOrder: number,
  iteration: number,
  deps: WorkflowNonstreamDeps = defaultWorkflowNonstreamDeps,
): Promise<SearchResult[]> {
  await deps.updateSession(ctx, args.sessionId, {
    status: "deepening",
    progress: computeProgress(args.complexity, "depth_iteration", iteration),
    currentPhase: "deepening",
    phaseOrder,
  }, args);

  const operationStartedAt = Date.now();
  await captureBackendAIOperationStarted(ctx, {
    userId: args.userId,
    operation: "research_depth_search",
    source: researchBackendAnalyticsSource(args),
    analytics: args.analytics,
    chatId: String(args.chatId),
    messageId: String(args.assistantMessageId),
    jobId: String(args.jobId),
    modelId: searchModel,
    properties: researchOperationProperties(args, phaseOrder, {
      iteration,
      query_count: queries.length,
    }),
  });
  let results: SearchResult[];
  try {
    results = await deps.executePerplexitySearch(
      queries,
      searchModel,
      args.apiKey,
      {
        maxTokens: resolveSearchMaxTokens("paper", args.complexity, searchModel),
        requireZdr: args.requireZdr === true,
      },
    );
  } catch (error) {
    await captureBackendAIOperationFailed(ctx, {
      userId: args.userId,
      operation: "research_depth_search",
      source: researchBackendAnalyticsSource(args),
      analytics: args.analytics,
      chatId: String(args.chatId),
      messageId: String(args.assistantMessageId),
      jobId: String(args.jobId),
      modelId: searchModel,
      durationMs: Date.now() - operationStartedAt,
      error,
      properties: researchOperationProperties(args, phaseOrder, {
        iteration,
        query_count: queries.length,
      }),
    });
    throw error;
  }
  await checkCancellation(ctx, args.sessionId, args);

  await captureBackendAIOperationCompleted(ctx, {
    userId: args.userId,
    operation: "research_depth_search",
    source: researchBackendAnalyticsSource(args),
    analytics: args.analytics,
    chatId: String(args.chatId),
    messageId: String(args.assistantMessageId),
    jobId: String(args.jobId),
    modelId: searchModel,
    usage: aggregateSearchUsage(results),
    durationMs: Date.now() - operationStartedAt,
    properties: researchOperationProperties(args, phaseOrder, {
      iteration,
      query_count: queries.length,
      result_count: results.length,
      successful_result_count: results.filter((result) => result.success).length,
      failed_result_count: results.filter((result) => !result.success).length,
    }),
  });

  // M23: Track Perplexity search costs.
  await deps.trackPerplexitySearchCosts(ctx, results, {
    messageId: args.assistantMessageId,
    chatId: args.chatId,
    userId: args.userId,
    searchModel,
  });

  await ctx.runMutation(internal.search.mutations.writeSearchPhase, {
    sessionId: args.sessionId,
    phaseType: "depth_iteration",
    phaseOrder,
    iteration,
    data: { results },
    executionAttemptId: args.executionAttemptId,
    executionFence: args.executionFence,
  });

  return results;
}

export async function runSynthesisPhase(
  ctx: ActionCtx,
  args: PipelineArgsWithApiKey,
  allResults: SearchResult[],
  phaseOrder: number,
  deps: WorkflowNonstreamDeps = defaultWorkflowNonstreamDeps,
): Promise<StructuredPhaseResult> {
  await deps.updateSession(ctx, args.sessionId, {
    status: "synthesizing",
    progress: computeProgress(args.complexity, "synthesis", 0),
    currentPhase: "synthesizing",
    phaseOrder,
  }, args);

  const allResultsSummary = summarizeSearchResults(allResults, Number.MAX_SAFE_INTEGER);

  const prompt = buildResearchSynthesisPrompt(
    allResultsSummary,
    await researchTemporalForSession(ctx, args),
  );
  const messages = await buildOrchestrationMessages(ctx, args, prompt);
  const operationStartedAt = Date.now();
  await captureBackendAIOperationStarted(ctx, {
    userId: args.userId,
    operation: "research_synthesis",
    source: researchBackendAnalyticsSource(args),
    analytics: args.analytics,
    chatId: String(args.chatId),
    messageId: String(args.assistantMessageId),
    jobId: String(args.jobId),
    modelId: args.modelId,
    properties: researchOperationProperties(args, phaseOrder, {
      result_count: allResults.length,
      request_message_count: messages.length,
    }),
  });
  let result: Awaited<ReturnType<typeof deps.callOpenRouterNonStreaming>>;
  try {
    result = await deps.callOpenRouterNonStreaming(
      args.apiKey,
      args.modelId,
      messages,
      withZdrProvider(
        {
          temperature: 0.3,
          maxTokens: args.maxTokens,
          includeReasoning: false,
          reasoningEffort: null,
          transforms: SEARCH_TRANSFORMS,
        },
        args.requireZdr === true,
      ),
      { fallbackModel: MODEL_IDS.searchResearchOrchestration },
    );
  } catch (error) {
    await captureBackendAIOperationFailed(ctx, {
      userId: args.userId,
      operation: "research_synthesis",
      source: researchBackendAnalyticsSource(args),
      analytics: args.analytics,
      chatId: String(args.chatId),
      messageId: String(args.assistantMessageId),
      jobId: String(args.jobId),
      modelId: args.modelId,
      durationMs: Date.now() - operationStartedAt,
      error,
      properties: researchOperationProperties(args, phaseOrder, {
        result_count: allResults.length,
        request_message_count: messages.length,
      }),
    });
    throw error;
  }
  await checkCancellation(ctx, args.sessionId, args);

  const artifact = parseStructuredArtifact(result.content, {
    findings: "No synthesis output was returned; use collected results from the session context.",
    sourceNotes: [],
    literatureMatrix: [],
    claimBank: [],
    contradictions: [],
    limitations: ["Limited or unavailable synthesis output."],
    researchGaps: [],
  });
  const synthesisData = JSON.stringify(artifact);

  await captureBackendAIOperationCompleted(ctx, {
    userId: args.userId,
    operation: "research_synthesis",
    source: researchBackendAnalyticsSource(args),
    analytics: args.analytics,
    chatId: String(args.chatId),
    messageId: String(args.assistantMessageId),
    jobId: String(args.jobId),
    modelId: args.modelId,
    usage: result.usage,
    durationMs: Date.now() - operationStartedAt,
    openrouterGenerationId: result.generationId,
    properties: researchOperationProperties(args, phaseOrder, {
      result_count: allResults.length,
      request_message_count: messages.length,
    }),
  });

  // M23: Track research synthesis cost.
  if (result.usage) {
    await ctx.scheduler.runAfter(0, internal.chat.mutations.storeAncillaryCost, {
      messageId: args.assistantMessageId,
      chatId: args.chatId,
      userId: args.userId,
      modelId: args.modelId,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      cost: result.usage.cost ?? undefined,
      source: "search_synthesis",
      generationId: result.generationId ?? undefined,
    });
  }

  await ctx.runMutation(internal.search.mutations.writeSearchPhase, {
    sessionId: args.sessionId,
    phaseType: "synthesis",
    phaseOrder,
    data: artifact,
    executionAttemptId: args.executionAttemptId,
    executionFence: args.executionFence,
  });

  return synthesisData;
}

export async function runPaperArchitecturePhase(
  ctx: ActionCtx,
  args: PipelineArgsWithApiKey,
  planningData: string,
  synthesisData: string,
  phaseOrder: number,
  deps: WorkflowNonstreamDeps = defaultWorkflowNonstreamDeps,
): Promise<StructuredPhaseResult> {
  await deps.updateSession(ctx, args.sessionId, {
    status: "synthesizing",
    progress: computeProgress(args.complexity, "synthesis", 0),
    currentPhase: "synthesizing",
    phaseOrder,
  }, args);

  const prompt = buildPaperArchitecturePrompt(
    `Planning artifact:\n${planningData}\n\nSynthesis artifact:\n${synthesisData}`,
    args.complexity,
    await researchTemporalForSession(ctx, args),
  );
  const messages = await buildOrchestrationMessages(ctx, args, prompt);
  const operationStartedAt = Date.now();
  await captureBackendAIOperationStarted(ctx, {
    userId: args.userId,
    operation: "research_paper_architecture",
    source: researchBackendAnalyticsSource(args),
    analytics: args.analytics,
    chatId: String(args.chatId),
    messageId: String(args.assistantMessageId),
    jobId: String(args.jobId),
    modelId: args.modelId,
    properties: researchOperationProperties(args, phaseOrder, {
      planning_data_present: planningData.trim().length > 0,
      synthesis_data_present: synthesisData.trim().length > 0,
      request_message_count: messages.length,
    }),
  });
  let result: Awaited<ReturnType<typeof deps.callOpenRouterNonStreaming>>;
  try {
    result = await deps.callOpenRouterNonStreaming(
      args.apiKey,
      args.modelId,
      messages,
      withZdrProvider(
        {
          temperature: 0.3,
          maxTokens: args.maxTokens,
          includeReasoning: false,
          reasoningEffort: null,
          transforms: SEARCH_TRANSFORMS,
        },
        args.requireZdr === true,
      ),
      { fallbackModel: MODEL_IDS.searchResearchOrchestration },
    );
  } catch (error) {
    await captureBackendAIOperationFailed(ctx, {
      userId: args.userId,
      operation: "research_paper_architecture",
      source: researchBackendAnalyticsSource(args),
      analytics: args.analytics,
      chatId: String(args.chatId),
      messageId: String(args.assistantMessageId),
      jobId: String(args.jobId),
      modelId: args.modelId,
      durationMs: Date.now() - operationStartedAt,
      error,
      properties: researchOperationProperties(args, phaseOrder, {
        planning_data_present: planningData.trim().length > 0,
        synthesis_data_present: synthesisData.trim().length > 0,
        request_message_count: messages.length,
      }),
    });
    throw error;
  }
  await checkCancellation(ctx, args.sessionId, args);

  const artifact = parseStructuredArtifact(result.content, {
    title: args.query,
    structurePattern: "Fallback structure based on available synthesis.",
    thesis: "Use the synthesis findings to answer the research question cautiously.",
    outline: [],
    evidenceMap: [],
    argumentBlueprint: [],
    draftingNotes: ["Architecture generation returned no structured artifact; draft from synthesis and search context."],
  });
  const architectureData = JSON.stringify(artifact);

  await captureBackendAIOperationCompleted(ctx, {
    userId: args.userId,
    operation: "research_paper_architecture",
    source: researchBackendAnalyticsSource(args),
    analytics: args.analytics,
    chatId: String(args.chatId),
    messageId: String(args.assistantMessageId),
    jobId: String(args.jobId),
    modelId: args.modelId,
    usage: result.usage,
    durationMs: Date.now() - operationStartedAt,
    openrouterGenerationId: result.generationId,
    properties: researchOperationProperties(args, phaseOrder, {
      planning_data_present: planningData.trim().length > 0,
      synthesis_data_present: synthesisData.trim().length > 0,
      request_message_count: messages.length,
    }),
  });

  if (result.usage) {
    await ctx.scheduler.runAfter(0, internal.chat.mutations.storeAncillaryCost, {
      messageId: args.assistantMessageId,
      chatId: args.chatId,
      userId: args.userId,
      modelId: args.modelId,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      cost: result.usage.cost ?? undefined,
      source: "search_architecture",
      generationId: result.generationId ?? undefined,
    });
  }

  await ctx.runMutation(internal.search.mutations.writeSearchPhase, {
    sessionId: args.sessionId,
    phaseType: "paper_architecture",
    phaseOrder,
    data: artifact,
    executionAttemptId: args.executionAttemptId,
    executionFence: args.executionFence,
  });

  return architectureData;
}
