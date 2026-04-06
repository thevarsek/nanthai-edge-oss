import { internal } from "../_generated/api";
import { ActionCtx } from "../_generated/server";
import { callOpenRouterNonStreaming } from "../lib/openrouter";
import {
  buildResearchPlanningPrompt,
  buildResearchAnalysisPrompt,
  buildResearchSynthesisPrompt,
  executePerplexitySearch,
  SEARCH_TRANSFORMS,
  SearchResult,
} from "./helpers";
import { MODEL_IDS } from "../lib/model_constants";
import { computeProgress, PipelineArgs, updateSession } from "./workflow_shared";
import { trackPerplexitySearchCosts } from "./actions_web_search_shared";

type PipelineArgsWithApiKey = PipelineArgs & { apiKey: string };

interface PlanningResult {
  plan: string;
  queries: string[];
}

interface AnalysisResult {
  gaps: string;
  queries: string[];
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
): Promise<PlanningResult> {
  await updateSession(ctx, args.sessionId, {
    status: "planning",
    progress: computeProgress(args.complexity, "planning", 0),
    currentPhase: "planning",
    phaseOrder,
  });

  const prompt = buildResearchPlanningPrompt(args.query, breadth);
  const messages = await buildOrchestrationMessages(ctx, args, prompt);
  const result = await callOpenRouterNonStreaming(
    args.apiKey,
    args.modelId,
    messages,
    { temperature: 0.7, maxTokens: 4096, transforms: SEARCH_TRANSFORMS },
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

  let plan = "";
  let queries: string[] = [];

  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      plan = parsed.plan ?? "";
      queries = Array.isArray(parsed.queries)
        ? parsed.queries
          .filter((q: unknown) => typeof q === "string" && (q as string).trim().length > 0)
          .slice(0, breadth)
        : [];
    }
  } catch {
    // Fall through
  }

  if (queries.length === 0) {
    queries = [args.query];
    plan = `Direct research on: ${args.query}`;
  }

  await ctx.runMutation(internal.search.mutations.writeSearchPhase, {
    sessionId: args.sessionId,
    phaseType: "planning",
    phaseOrder,
    data: { plan, queries },
  });

  return { plan, queries };
}

export async function runInitialSearchPhase(
  ctx: ActionCtx,
  args: PipelineArgsWithApiKey,
  queries: string[],
  searchModel: string,
  phaseOrder: number,
): Promise<SearchResult[]> {
  await updateSession(ctx, args.sessionId, {
    status: "searching",
    progress: computeProgress(args.complexity, "initial_search", 0),
    currentPhase: "searching",
    phaseOrder,
  });

  const results = await executePerplexitySearch(queries, searchModel, args.apiKey);

  // M23: Track Perplexity search costs.
  await trackPerplexitySearchCosts(ctx, results, {
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
): Promise<AnalysisResult> {
  await updateSession(ctx, args.sessionId, {
    status: "analyzing",
    progress: computeProgress(args.complexity, "analysis", iteration),
    currentPhase: "analyzing",
    phaseOrder,
  });

  const priorSummary = priorResults
    .filter((r) => r.success)
    .map((r, i) => `[Result ${i + 1}] Query: "${r.query}"\n${r.content.slice(0, 2000)}`)
    .join("\n\n---\n\n");

  const prompt = buildResearchAnalysisPrompt(priorSummary, breadth);
  const messages = await buildOrchestrationMessages(ctx, args, prompt);
  const result = await callOpenRouterNonStreaming(
    args.apiKey,
    args.modelId,
    messages,
    { temperature: 0.5, maxTokens: 4096, transforms: SEARCH_TRANSFORMS },
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

  let gaps = "";
  let queries: string[] = [];

  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      gaps = parsed.gaps ?? "";
      queries = Array.isArray(parsed.queries)
        ? parsed.queries
          .filter((q: unknown) => typeof q === "string" && (q as string).trim().length > 0)
          .slice(0, breadth)
        : [];
    }
  } catch {
    // Fall through
  }

  if (queries.length === 0) {
    queries = [`More details about: ${args.query}`];
    gaps = "Could not parse gap analysis; performing general follow-up search.";
  }

  await ctx.runMutation(internal.search.mutations.writeSearchPhase, {
    sessionId: args.sessionId,
    phaseType: "analysis",
    phaseOrder,
    iteration,
    data: { gaps, queries },
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
): Promise<SearchResult[]> {
  await updateSession(ctx, args.sessionId, {
    status: "deepening",
    progress: computeProgress(args.complexity, "depth_iteration", iteration),
    currentPhase: "deepening",
    phaseOrder,
  });

  const results = await executePerplexitySearch(queries, searchModel, args.apiKey);

  // M23: Track Perplexity search costs.
  await trackPerplexitySearchCosts(ctx, results, {
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
): Promise<string> {
  await updateSession(ctx, args.sessionId, {
    status: "synthesizing",
    progress: computeProgress(args.complexity, "synthesis", 0),
    currentPhase: "synthesizing",
    phaseOrder,
  });

  const allResultsSummary = allResults
    .filter((r) => r.success)
    .map((r, i) => {
      const citations = r.citations.length > 0
        ? `\nSources: ${r.citations.map((c, j) => `[${j + 1}] ${c}`).join(", ")}`
        : "";
      return `[Result ${i + 1}] Query: "${r.query}"\n${r.content}${citations}`;
    })
    .join("\n\n---\n\n");

  const prompt = buildResearchSynthesisPrompt(allResultsSummary);
  const messages = await buildOrchestrationMessages(ctx, args, prompt);
  const result = await callOpenRouterNonStreaming(
    args.apiKey,
    args.modelId,
    messages,
    { temperature: 0.3, maxTokens: 8192, transforms: SEARCH_TRANSFORMS },
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

  let synthesisData = result.content.trim();
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      synthesisData = JSON.stringify(parsed);
    }
  } catch {
    // Use raw content as-is
  }

  if (!synthesisData) {
    synthesisData = JSON.stringify({
      findings: "No synthesis output was returned; use collected results from the session context.",
      sources: [],
    });
  }

  await ctx.runMutation(internal.search.mutations.writeSearchPhase, {
    sessionId: args.sessionId,
    phaseType: "synthesis",
    phaseOrder,
    data: synthesisData,
  });

  return synthesisData;
}
