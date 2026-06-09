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
  computeProgress,
  PipelineArgs,
  updateSession,
} from "./workflow_shared";
import { trackPerplexitySearchCosts } from "./actions_web_search_shared";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";

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
  });

  const prompt = buildResearchPlanningPrompt(args.query, breadth);
  const messages = await buildOrchestrationMessages(ctx, args, prompt);
  const result = await deps.callOpenRouterNonStreaming(
    args.apiKey,
    args.modelId,
    messages,
    withZdrProvider(
      { temperature: 0.7, maxTokens: 4096, transforms: SEARCH_TRANSFORMS },
      args.requireZdr === true,
    ),
    { fallbackModel: MODEL_IDS.searchResearchOrchestration },
  );

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

  const artifact = parsePlanningArtifact(result.content, args.query, breadth);
  const queries = artifact.queries.map((query) => query.query);
  const plan = artifact.plan;

  await ctx.runMutation(internal.search.mutations.writeSearchPhase, {
    sessionId: args.sessionId,
    phaseType: "planning",
    phaseOrder,
    data: artifact,
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
  });

  const results = await deps.executePerplexitySearch(
    queries,
    searchModel,
    args.apiKey,
    {
      maxTokens: resolveSearchMaxTokens("paper", args.complexity, searchModel),
      requireZdr: args.requireZdr === true,
    },
  );

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
  });

  const priorSummary = summarizeSearchResults(priorResults, 2000);

  const prompt = buildResearchAnalysisPrompt(priorSummary, breadth);
  const messages = await buildOrchestrationMessages(ctx, args, prompt);
  const result = await deps.callOpenRouterNonStreaming(
    args.apiKey,
    args.modelId,
    messages,
    withZdrProvider(
      { temperature: 0.5, maxTokens: 4096, transforms: SEARCH_TRANSFORMS },
      args.requireZdr === true,
    ),
    { fallbackModel: MODEL_IDS.searchResearchOrchestration },
  );

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

  const artifact = parseAnalysisArtifact(result.content, args.query, breadth);
  const gaps = artifact.coverageSummary;
  const queries = artifact.followUpQueries.map((query) => query.query);

  await ctx.runMutation(internal.search.mutations.writeSearchPhase, {
    sessionId: args.sessionId,
    phaseType: "analysis",
    phaseOrder,
    iteration,
    data: artifact,
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
  });

  const results = await deps.executePerplexitySearch(
    queries,
    searchModel,
    args.apiKey,
    {
      maxTokens: resolveSearchMaxTokens("paper", args.complexity, searchModel),
      requireZdr: args.requireZdr === true,
    },
  );

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
  });

  const allResultsSummary = summarizeSearchResults(allResults, Number.MAX_SAFE_INTEGER);

  const prompt = buildResearchSynthesisPrompt(allResultsSummary);
  const messages = await buildOrchestrationMessages(ctx, args, prompt);
  const result = await deps.callOpenRouterNonStreaming(
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

  await ctx.runMutation(internal.search.mutations.writeSearchPhase, {
    sessionId: args.sessionId,
    phaseType: "synthesis",
    phaseOrder,
    data: artifact,
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
  });

  const prompt = buildPaperArchitecturePrompt(
    `Planning artifact:\n${planningData}\n\nSynthesis artifact:\n${synthesisData}`,
    args.complexity,
  );
  const messages = await buildOrchestrationMessages(ctx, args, prompt);
  const result = await deps.callOpenRouterNonStreaming(
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

  await ctx.runMutation(internal.search.mutations.writeSearchPhase, {
    sessionId: args.sessionId,
    phaseType: "paper_architecture",
    phaseOrder,
    data: artifact,
  });

  return architectureData;
}
