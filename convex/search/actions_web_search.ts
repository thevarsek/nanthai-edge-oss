import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { ActionCtx } from "../_generated/server";
import { callOpenRouterNonStreaming } from "../lib/openrouter";
import {
  GenerationCancelledError,
  isGenerationCancelledError,
} from "../chat/generation_helpers";
import {
  resolveComplexityPreset,
  executePerplexitySearch,
  buildQueryGenerationPrompt,
  parseGeneratedQueries,
  buildSearchSynthesisPrompt,
  CITATION_SYSTEM_PROMPT_SUFFIX,
  SEARCH_TRANSFORMS,
  SearchResult,
} from "./helpers";
import { MODEL_IDS } from "../lib/model_constants";
import {
  runWebSearchArgs,
  trackPerplexitySearchCosts,
  updateSession,
  WebSearchActionArgs,
} from "./actions_web_search_shared";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";

export const runWebSearch = internalAction({
  args: runWebSearchArgs,
  handler: runWebSearchHandler,
});

async function runWebSearchHandler(
  ctx: ActionCtx,
  args: WebSearchActionArgs,
): Promise<void> {
  await ctx.runMutation(internal.chat.mutations.updateJobStatus, {
    jobId: args.jobId,
    status: "streaming",
    startedAt: Date.now(),
  });

  try {
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, args.userId);
    const preset = resolveComplexityPreset("web", args.complexity);
    let searchResults: SearchResult[];

    if (args.cachedSearchContext) {
      const cached = args.cachedSearchContext as {
        searchResults?: SearchResult[];
      };
      searchResults = cached.searchResults ?? [];

      await updateSession(ctx, args.sessionId, {
        status: "synthesizing",
        progress: 70,
        currentPhase: "synthesizing",
      });
    } else if (args.complexity === 1) {
      searchResults = await runDirectSearch(ctx, args, preset.searchModel, apiKey);
    } else {
      searchResults = await runQueryGenAndSearch(ctx, args, preset, apiKey);
    }

    const searchContext = {
      complexity: args.complexity,
      queries: searchResults.map((r) => r.query),
      searchResults,
    };
    await ctx.runMutation(internal.search.mutations.patchMessageSearchContext, {
      messageId: args.assistantMessageId,
      chatId: args.chatId,
      userId: args.userId,
      mode: "web",
      searchContext,
    });

    const cancelled = await ctx.runQuery(
      internal.chat.queries.isJobCancelled,
      { jobId: args.jobId },
    );
    if (cancelled) throw new GenerationCancelledError();

    // Build search-augmented system prompt: original persona prompt + search
    // results + citation instructions.
    const searchSynthesis = buildSearchSynthesisPrompt(searchResults);
    const basePrompt = args.systemPrompt ?? "";
    const augmentedSystemPrompt = basePrompt
      ? `${basePrompt}\n\n${searchSynthesis}${CITATION_SYSTEM_PROMPT_SUFFIX}`
      : `${searchSynthesis}${CITATION_SYSTEM_PROMPT_SUFFIX}`;

    // Hand off to the full generation pipeline (runGeneration) so the model
    // has access to tools, skills, progressive loading, memory, etc.
    // The job status is already "streaming" — runGeneration will re-set it
    // (idempotent) and handle finalization, post-processing, and tool loops.
    await ctx.scheduler.runAfter(0, internal.chat.actions.runGeneration, {
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      assistantMessageIds: [args.assistantMessageId],
      generationJobIds: [args.jobId],
      participants: [
        {
          modelId: args.modelId,
          personaId: args.personaId ?? null,
          systemPrompt: augmentedSystemPrompt,
          temperature: args.temperature,
          maxTokens: args.maxTokens,
          includeReasoning: args.includeReasoning,
          reasoningEffort: args.reasoningEffort ?? null,
          messageId: args.assistantMessageId,
          jobId: args.jobId,
        },
      ],
      userId: args.userId,
      expandMultiModelGroups: args.expandMultiModelGroups,
      webSearchEnabled: false, // Perplexity already searched; no need for OpenRouter web plugin
      enabledIntegrations: args.enabledIntegrations,
      subagentsEnabled: args.subagentsEnabled,
      searchSessionId: args.sessionId,
    });

    // Write search stats but keep status as "writing" — runGeneration will
    // mark the session "completed" (or "failed") when generation finishes.
    await updateSession(ctx, args.sessionId, {
      status: "writing",
      progress: 90,
      currentPhase: "writing",
      searchCallCount: searchResults.length,
      perplexityModelTier: preset.searchModel,
      participantCount: 1,
    });

    // Note: postProcess is now handled by runGeneration, so we don't schedule
    // it here (would cause a duplicate).
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown search error";
    const wasCancelled = isGenerationCancelledError(error);

    await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
      messageId: args.assistantMessageId,
      jobId: args.jobId,
      chatId: args.chatId,
      content: wasCancelled ? "[Search cancelled]" : `Error: ${errorMessage}`,
      status: wasCancelled ? "cancelled" : "failed",
      error: errorMessage,
      userId: args.userId,
    });

    try {
      await updateSession(ctx, args.sessionId, {
        status: wasCancelled ? "cancelled" : "failed",
        currentPhase: wasCancelled ? "cancelled" : "failed",
        errorMessage: wasCancelled ? undefined : errorMessage,
        completedAt: Date.now(),
      });
    } catch (sessionError) {
      console.error(
        "[runWebSearch] Failed to update search session on error:",
        sessionError instanceof Error ? sessionError.message : String(sessionError),
      );
    }
  }
}

async function runDirectSearch(
  ctx: ActionCtx,
  args: WebSearchActionArgs,
  searchModel: string,
  apiKey: string,
): Promise<SearchResult[]> {
  await updateSession(ctx, args.sessionId, {
    status: "searching",
    progress: 20,
    currentPhase: "searching",
  });

  const results = await executePerplexitySearch(
    [args.query],
    searchModel,
    apiKey,
  );

  // M23: Track Perplexity search costs.
  await trackPerplexitySearchCosts(ctx, results, {
    messageId: args.assistantMessageId,
    chatId: args.chatId,
    userId: args.userId,
    searchModel,
  });

  await updateSession(ctx, args.sessionId, {
    status: "synthesizing",
    progress: 50,
    currentPhase: "synthesizing",
  });

  return results;
}

async function runQueryGenAndSearch(
  ctx: ActionCtx,
  args: WebSearchActionArgs,
  preset: ReturnType<typeof resolveComplexityPreset>,
  apiKey: string,
): Promise<SearchResult[]> {
  await updateSession(ctx, args.sessionId, {
    status: "planning",
    progress: 10,
    currentPhase: "planning",
  });

  const queryGenPrompt = buildQueryGenerationPrompt(args.query, preset.breadth);
  let queryGenSystemPrompt = args.systemPrompt;
  if (!queryGenSystemPrompt && args.personaId) {
    const persona = await ctx.runQuery(internal.chat.queries.getPersona, {
      personaId: args.personaId,
      userId: args.userId,
    });
    if (persona?.systemPrompt) {
      queryGenSystemPrompt = persona.systemPrompt;
    }
  }
  const queryGenMessages = queryGenSystemPrompt
    ? [
      { role: "system" as const, content: queryGenSystemPrompt },
      { role: "user" as const, content: queryGenPrompt },
    ]
    : [{ role: "user" as const, content: queryGenPrompt }];

  const queryGenResult = await callOpenRouterNonStreaming(
    apiKey,
    args.modelId,
    queryGenMessages,
    { temperature: 0.7, maxTokens: 2048, transforms: SEARCH_TRANSFORMS },
    { fallbackModel: MODEL_IDS.searchQueryGeneration },
  );

  // M23: Track search query generation cost.
  if (queryGenResult.usage) {
    await ctx.scheduler.runAfter(0, internal.chat.mutations.storeAncillaryCost, {
      messageId: args.assistantMessageId,
      chatId: args.chatId,
      userId: args.userId,
      modelId: args.modelId,
      promptTokens: queryGenResult.usage.promptTokens,
      completionTokens: queryGenResult.usage.completionTokens,
      totalTokens: queryGenResult.usage.totalTokens,
      cost: queryGenResult.usage.cost ?? undefined,
      source: "search_query_gen",
      generationId: queryGenResult.generationId ?? undefined,
    });
  }

  const queries = parseGeneratedQueries(
    queryGenResult.content,
    args.query,
    preset.breadth,
  );

  const cancelled = await ctx.runQuery(
    internal.chat.queries.isJobCancelled,
    { jobId: args.jobId },
  );
  if (cancelled) throw new GenerationCancelledError();

  await updateSession(ctx, args.sessionId, {
    status: "searching",
    progress: 30,
    currentPhase: "searching",
  });

  const results = await executePerplexitySearch(
    queries,
    preset.searchModel,
    apiKey,
  );

  // M23: Track Perplexity search costs.
  await trackPerplexitySearchCosts(ctx, results, {
    messageId: args.assistantMessageId,
    chatId: args.chatId,
    userId: args.userId,
    searchModel: preset.searchModel,
  });

  await updateSession(ctx, args.sessionId, {
    status: "synthesizing",
    progress: 70,
    currentPhase: "synthesizing",
  });

  return results;
}
