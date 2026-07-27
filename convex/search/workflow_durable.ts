// convex/search/workflow_durable.ts
// =============================================================================
// Durable research paper phase actions. Convex Workflow owns ordering and
// invokes each phase, so no action schedules a second orchestration chain.
//
// State flows through the DB: each phase writes to `searchPhases` via
// `writeSearchPhase`, and each subsequent Workflow step reconstructs
// accumulated state by reading those rows through `getSearchPhases`.
// =============================================================================

import { ConvexError, v, type PropertyValidators } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { ActionCtx } from "../_generated/server";
import { integrationOverrideEntry } from "../schema_validators";
import { analyticsClientMetadataValidator } from "../analytics/client_metadata";
import { analyticsSourceValidator } from "../chat/actions_args";
import {
  isGenerationCancelledError,
} from "../chat/generation_helpers";
import {
  captureAssistantResponseFailure,
  captureAssistantResponseStartedEvent,
} from "../chat/generation_analytics";
import { extractQueryStrings, resolveComplexityPreset, SearchResult } from "./helpers";
import {
  checkCancellation,
  formatResearchPaperFailureMessage,
  PipelineArgs,
  projectPipelineArgs,
  updateSession,
} from "./workflow_shared";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import {
  assertModelSupportsZdr,
  isZdrEnabled,
} from "../lib/openrouter_zdr";
import {
  runPlanningPhase,
  runInitialSearchPhase,
  runAnalysisPhase,
  runDepthSearchPhase,
  runPaperArchitecturePhase,
  runSynthesisPhase,
  createWorkflowNonstreamDepsForTest,
} from "./workflow_nonstream_phases";
import { runPaperGenerationPhase } from "./workflow_paper_phase";
import {
  assertModelAvailable,
  assertTextGenerationModel,
} from "../lib/openrouter_modality";

// -- Shared args for every phase action ----------------------------------------

const phaseActionArgs = {
  sessionId: v.id("searchSessions"),
  assistantMessageId: v.id("messages"),
  jobId: v.id("generationJobs"),
  chatId: v.id("chats"),
  userMessageId: v.id("messages"),
  userId: v.string(),
  query: v.string(),
  complexity: v.number(),
  expandMultiModelGroups: v.boolean(),
  modelId: v.string(),
  personaId: v.optional(v.id("personas")),
  systemPrompt: v.optional(v.string()),
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  includeReasoning: v.optional(v.boolean()),
  reasoningEffort: v.optional(v.string()),
  enabledIntegrations: v.optional(v.array(v.string())),
  turnIntegrationOverrides: v.optional(v.array(integrationOverrideEntry)),
  subagentsEnabled: v.optional(v.boolean()),
  analytics: v.optional(analyticsClientMetadataValidator),
  analyticsSource: v.optional(analyticsSourceValidator),
  // Phase-specific: tracks where we are in the pipeline
  phaseOrder: v.number(),
  // For depth loop phases: which iteration we're on
  depthIteration: v.optional(v.number()),
  searchBatchId: v.optional(v.id("researchSearchBatches")),
  executionAttemptId: v.optional(v.id("executionAttempts")),
  executionFence: v.optional(v.number()),
} satisfies PropertyValidators;

// Inferred type from the validator — matches PipelineArgs plus phase fields.
type PhaseActionArgs = PipelineArgs & {
  phaseOrder: number;
  depthIteration?: number;
  searchBatchId?: import("../_generated/dataModel").Id<"researchSearchBatches">;
};

function precomputedSearchDeps(
  ctx: ActionCtx,
  batchId: import("../_generated/dataModel").Id<"researchSearchBatches">,
  requireZdr: boolean,
) {
  return createWorkflowNonstreamDepsForTest({
    executePerplexitySearch: async () => {
      const results = await ctx.runQuery(
        internal.search.research_fanout_queries.getResearchSearchBatchResults,
        { batchId },
      ) as SearchResult[];
      if (requireZdr && results.length > 0 && results.every((result) => !result.success)) {
        throw new ConvexError({
          code: "ZDR_SEARCH_UNAVAILABLE" as const,
          message: "Research search is unavailable with Zero Data Retention.",
        });
      }
      return results;
    },
  });
}

// -- Helpers -------------------------------------------------------------------

/**
 * Reconstruct accumulated search results from persisted `searchPhases` rows.
 * Reads all `initial_search` and `depth_iteration` phases for the session,
 * preserving the full SearchResult shape (content, citations, usage, etc.).
 */
export async function reconstructSearchResults(
  ctx: ActionCtx,
  sessionId: PipelineArgs["sessionId"],
): Promise<SearchResult[]> {
  const phases = await ctx.runQuery(
    internal.search.queries.getSearchPhases,
    { sessionId },
  );

  const results: SearchResult[] = [];
  for (const phase of phases) {
    if (
      phase.phaseType === "initial_search" ||
      phase.phaseType === "depth_iteration"
    ) {
      const data = phase.data as { results?: SearchResult[] };
      if (Array.isArray(data?.results)) {
        results.push(...data.results);
      }
    }
  }
  return results;
}

/**
 * Read the queries produced by the most recent planning or analysis phase.
 */
export async function readQueriesFromPhase(
  ctx: ActionCtx,
  sessionId: PipelineArgs["sessionId"],
  phaseType: "planning" | "analysis",
  iteration?: number,
): Promise<string[]> {
  const phases = await ctx.runQuery(
    internal.search.queries.getSearchPhases,
    { sessionId },
  );

  // Find matching phase — for analysis, match on iteration too
  for (const phase of [...phases].reverse()) {
    if (phase.phaseType !== phaseType) continue;
    if (phaseType === "analysis" && phase.iteration !== iteration) continue;
    const data = phase.data as { queries?: unknown; followUpQueries?: unknown };
    const queries = extractQueryStrings(
      phaseType === "analysis" ? (data?.followUpQueries ?? data?.queries) : data?.queries,
    );
    if (queries.length > 0) return queries;
  }

  // Fallback — should not happen if prior phase succeeded
  return [];
}

/**
 * Standard error handler for any phase action. Finalizes the generation and
 * session with cancelled or failed status.
 */
export async function handlePhaseError(
  ctx: ActionCtx,
  args: PipelineArgs,
  error: unknown,
  durationMs?: number,
): Promise<void> {
  const errorMessage = formatResearchPaperFailureMessage(error);
  const wasCancelled = isGenerationCancelledError(error);

  await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
    messageId: args.assistantMessageId,
    jobId: args.jobId,
    chatId: args.chatId,
    content: wasCancelled
      ? "[Research paper cancelled]"
      : `Error: ${errorMessage}`,
    status: wasCancelled ? "cancelled" : "failed",
    error: errorMessage,
    userId: args.userId,
  });
  await ctx.runMutation(internal.advisors.mutations_internal.completeBatchForMessage, {
    messageId: args.assistantMessageId,
  });
  if (!wasCancelled) {
    await captureAssistantResponseStartedEvent(ctx, {
      userId: args.userId,
      chatId: String(args.chatId),
      messageId: String(args.assistantMessageId),
      jobId: String(args.jobId),
      modelId: args.modelId,
      source: args.analyticsSource ?? "research_paper",
      analytics: args.analytics,
      participantCount: 1,
      integrationCount: args.enabledIntegrations?.length ?? 0,
      subagentsEnabled: args.subagentsEnabled === true,
      properties: {
        search_session_id: String(args.sessionId),
        complexity: args.complexity,
        pre_handoff_failure: true,
      },
    });
  }
  await captureAssistantResponseFailure(ctx, {
    userId: args.userId,
    chatId: String(args.chatId),
    messageId: String(args.assistantMessageId),
    jobId: String(args.jobId),
    modelId: args.modelId,
    source: args.analyticsSource ?? "research_paper",
    error,
    analytics: args.analytics,
    cancelled: wasCancelled,
    durationMs,
    properties: {
      search_session_id: String(args.sessionId),
      complexity: args.complexity,
      pre_handoff_failure: true,
      terminal_error_code: wasCancelled ? "cancelled_by_user" : undefined,
    },
  });

  try {
    await updateSession(ctx, args.sessionId, {
      status: wasCancelled ? "cancelled" : "failed",
      currentPhase: wasCancelled ? "cancelled" : "failed",
      errorMessage: wasCancelled ? undefined : errorMessage,
      completedAt: Date.now(),
    }, args);
  } catch (sessionError) {
    console.error(
      "[researchPaperDurable] Failed to update search session on error:",
      sessionError instanceof Error ? sessionError.message : String(sessionError),
    );
  }
}

async function buildArgsWithApiKeyAndPolicy(
  ctx: ActionCtx,
  args: PhaseActionArgs,
): Promise<{
  pipelineArgs: PipelineArgs;
  argsWithApiKey: PipelineArgs & { apiKey: string; requireZdr: boolean };
  requireZdr: boolean;
}> {
  const [apiKey, preferences] = await Promise.all([
    getRequiredUserOpenRouterApiKey(ctx, args.userId),
    ctx.runQuery(internal.chat.queries.getUserPreferences, {
      userId: args.userId,
    }),
  ]);
  const pipelineArgs = projectPipelineArgs(args);
  const requireZdr = isZdrEnabled(preferences);
  return {
    pipelineArgs,
    argsWithApiKey: { ...pipelineArgs, apiKey, requireZdr },
    requireZdr,
  };
}

async function assertPhaseModelPolicy(
  ctx: ActionCtx,
  modelId: string,
  feature: string,
  requireZdr: boolean,
): Promise<void> {
  const capabilities = await ctx.runQuery(internal.chat.queries.getModelCapabilities, {
    modelId,
  });
  assertModelAvailable({ modelId, capabilities, feature });
  assertTextGenerationModel({
    feature,
    hasImageGeneration: capabilities?.hasImageGeneration,
    hasVideoGeneration: capabilities?.hasVideoGeneration,
    hasAudioOutput: capabilities?.hasAudioOutput,
  });
  if (requireZdr) {
    assertModelSupportsZdr({ modelId, capabilities, feature });
  }
}

async function completedWorkflowPhase(
  ctx: ActionCtx,
  args: PhaseActionArgs,
  phaseType: string,
): Promise<boolean> {
  const phases = await ctx.runQuery(
    internal.search.queries.getSearchPhases,
    { sessionId: args.sessionId },
  );
  return phases.some((phase) =>
    phase.phaseOrder === args.phaseOrder
    && phase.phaseType === phaseType
    && (args.depthIteration === undefined || phase.iteration === args.depthIteration),
  );
}

// -- Phase 1: Planning --------------------------------------------------------

export const runPlanningAction = internalAction({
  args: phaseActionArgs,
  handler: async (ctx, args) => {
      if (await completedWorkflowPhase(ctx, args, "planning")) return;
      const { argsWithApiKey, requireZdr } =
        await buildArgsWithApiKeyAndPolicy(ctx, args);
      const preset = resolveComplexityPreset("paper", args.complexity);

      await assertPhaseModelPolicy(
        ctx,
        args.modelId,
        "Research planning",
        requireZdr,
      );
      await checkCancellation(ctx, args.sessionId, args);
      await runPlanningPhase(ctx, argsWithApiKey, preset.breadth, args.phaseOrder);

  },
});

// -- Phase 2: Initial Search --------------------------------------------------

export const runInitialSearchAction = internalAction({
  args: phaseActionArgs,
  handler: async (ctx, args) => {
      if (await completedWorkflowPhase(ctx, args, "initial_search")) return;
      const { argsWithApiKey, requireZdr } =
        await buildArgsWithApiKeyAndPolicy(ctx, args);
      const preset = resolveComplexityPreset("paper", args.complexity);

      // Read queries from persisted planning phase
      const queries = await readQueriesFromPhase(ctx, args.sessionId, "planning");
      if (queries.length === 0) {
        throw new Error("No queries found from planning phase");
      }

      await assertPhaseModelPolicy(
        ctx,
        preset.searchModel,
        "Research search",
        requireZdr,
      );
      await checkCancellation(ctx, args.sessionId, args);
      await runInitialSearchPhase(
        ctx,
        argsWithApiKey,
        queries,
        preset.searchModel,
        args.phaseOrder,
        args.searchBatchId
          ? precomputedSearchDeps(ctx, args.searchBatchId, requireZdr)
          : undefined,
      );

  },
});

// -- Phase 3a: Analysis (depth loop) ------------------------------------------

export const runAnalysisAction = internalAction({
  args: phaseActionArgs,
  handler: async (ctx, args) => {
      if (await completedWorkflowPhase(ctx, args, "analysis")) return;
      const { argsWithApiKey, requireZdr } =
        await buildArgsWithApiKeyAndPolicy(ctx, args);
      const preset = resolveComplexityPreset("paper", args.complexity);
      const iteration = args.depthIteration ?? 0;

      // Reconstruct all search results accumulated so far
      const allSearchResults = await reconstructSearchResults(ctx, args.sessionId);

      await assertPhaseModelPolicy(
        ctx,
        args.modelId,
        "Research analysis",
        requireZdr,
      );
      await checkCancellation(ctx, args.sessionId, args);
      await runAnalysisPhase(
        ctx,
        argsWithApiKey,
        allSearchResults,
        preset.breadth,
        args.phaseOrder,
        iteration,
      );

  },
});

// -- Phase 3b: Depth Search (depth loop) --------------------------------------

export const runDepthSearchAction = internalAction({
  args: phaseActionArgs,
  handler: async (ctx, args) => {
      if (await completedWorkflowPhase(ctx, args, "depth_iteration")) return;
      const { argsWithApiKey, requireZdr } =
        await buildArgsWithApiKeyAndPolicy(ctx, args);
      const preset = resolveComplexityPreset("paper", args.complexity);
      const iteration = args.depthIteration ?? 0;

      // Read queries from persisted analysis phase for this iteration
      const queries = await readQueriesFromPhase(
        ctx,
        args.sessionId,
        "analysis",
        iteration,
      );
      if (queries.length === 0) {
        throw new Error(`No queries found from analysis phase iteration ${iteration}`);
      }

      await assertPhaseModelPolicy(
        ctx,
        preset.searchModel,
        "Research search",
        requireZdr,
      );
      await checkCancellation(ctx, args.sessionId, args);
      await runDepthSearchPhase(
        ctx,
        argsWithApiKey,
        queries,
        preset.searchModel,
        args.phaseOrder,
        iteration,
        args.searchBatchId
          ? precomputedSearchDeps(ctx, args.searchBatchId, requireZdr)
          : undefined,
      );

  },
});

// -- Phase 4: Synthesis -------------------------------------------------------

export const runSynthesisAction = internalAction({
  args: phaseActionArgs,
  handler: async (ctx, args) => {
      if (await completedWorkflowPhase(ctx, args, "synthesis")) return;
      const { argsWithApiKey, requireZdr } =
        await buildArgsWithApiKeyAndPolicy(ctx, args);

      // Reconstruct all accumulated search results (with citations)
      const allSearchResults = await reconstructSearchResults(ctx, args.sessionId);

      await assertPhaseModelPolicy(
        ctx,
        args.modelId,
        "Research synthesis",
        requireZdr,
      );
      await checkCancellation(ctx, args.sessionId, args);
      await runSynthesisPhase(
        ctx,
        argsWithApiKey,
        allSearchResults,
        args.phaseOrder,
      );

  },
});

// -- Phase 5: Paper Architecture / Argument -----------------------------------

export const runPaperArchitectureAction = internalAction({
  args: phaseActionArgs,
  handler: async (ctx, args) => {
      if (await completedWorkflowPhase(ctx, args, "paper_architecture")) return;
      const { argsWithApiKey, requireZdr } =
        await buildArgsWithApiKeyAndPolicy(ctx, args);

      const phases = await ctx.runQuery(
        internal.search.queries.getSearchPhases,
        { sessionId: args.sessionId },
      );
      const planningData = stringifyLatestPhaseData(phases, "planning")
        ?? JSON.stringify({ researchQuestion: args.query, plan: `Direct research on: ${args.query}` });
      const synthesisData = stringifyLatestPhaseData(phases, "synthesis");
      if (!synthesisData) {
        throw new Error("No synthesis phase found — cannot build paper architecture");
      }

      await assertPhaseModelPolicy(
        ctx,
        args.modelId,
        "Research paper architecture",
        requireZdr,
      );
      await checkCancellation(ctx, args.sessionId, args);
      await runPaperArchitecturePhase(
        ctx,
        argsWithApiKey,
        planningData,
        synthesisData,
        args.phaseOrder,
      );

  },
});

// -- Phase 6: Paper Generation Handoff ----------------------------------------

export const runPaperHandoffAction = internalAction({
  args: phaseActionArgs,
  handler: async (ctx, args) => {
    const pipelineArgs = projectPipelineArgs(args);
      const preset = resolveComplexityPreset("paper", args.complexity);

      // Reconstruct all search results for the search context
      const allSearchResults = await reconstructSearchResults(ctx, args.sessionId);

      // Read synthesis data from persisted phase
      const phases = await ctx.runQuery(
        internal.search.queries.getSearchPhases,
        { sessionId: args.sessionId },
      );
      const planningData = stringifyLatestPhaseData(phases, "planning");
      const synthesisData = stringifyLatestPhaseData(phases, "synthesis");
      const architectureData = stringifyLatestPhaseData(phases, "paper_architecture");
      if (!synthesisData) {
        throw new Error("No synthesis phase found — cannot generate paper");
      }

      // Persist search context on the message (queries + full results with citations)
      const searchContext = {
        complexity: args.complexity,
        queries: allSearchResults.map((r) => r.query),
        searchResults: allSearchResults,
        synthesis: parseMaybeJson(synthesisData),
        ...(planningData ? { planning: parseMaybeJson(planningData) } : {}),
        ...(architectureData ? { architecture: parseMaybeJson(architectureData) } : {}),
      };
      await ctx.runMutation(internal.search.mutations.patchMessageSearchContext, {
        messageId: args.assistantMessageId,
        chatId: args.chatId,
        userId: args.userId,
        mode: "paper",
        searchContext,
        executionAttemptId: args.executionAttemptId,
        executionFence: args.executionFence,
      });

      await checkCancellation(ctx, args.sessionId, args);
      await runPaperGenerationPhase(ctx, pipelineArgs, synthesisData, args.phaseOrder, {
        planningData,
        architectureData,
      });

      // Write search stats — runGeneration (scheduled inside
      // runPaperGenerationPhase) will mark the session completed/failed.
      await updateSession(ctx, args.sessionId, {
        searchCallCount: allSearchResults.length,
        perplexityModelTier: preset.searchModel,
        participantCount: 1,
      }, args);
  },
});

export const finalizeResearchWorkflowFailure = internalAction({
  args: { ...phaseActionArgs, error: v.string() },
  returns: v.union(
    v.literal("failed"),
    v.literal("cancelled"),
    v.literal("completed"),
    v.literal("handed_off"),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.runQuery(
      internal.search.queries.getSearchSession,
      { sessionId: args.sessionId },
    );
    if (session?.status === "failed") return "failed" as const;
    if (session?.status === "cancelled") return "cancelled" as const;
    if (session?.status === "completed") return "completed" as const;
    if (session?.generationHandoffOperationId) return "handed_off" as const;
    await handlePhaseError(ctx, projectPipelineArgs(args), new Error(args.error));
    return "failed" as const;
  },
});

function stringifyLatestPhaseData(
  phases: Array<{ phaseType: string; phaseOrder: number; data: unknown }>,
  phaseType: string,
): string | null {
  const phase = [...phases]
    .filter((p) => p.phaseType === phaseType)
    .sort((a, b) => b.phaseOrder - a.phaseOrder)
    .at(0);
  if (!phase) return null;
  if (typeof phase.data === "string") {
    const trimmed = phase.data.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (phase.data == null) return null;
  try {
    return JSON.stringify(phase.data);
  } catch {
    return null;
  }
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
