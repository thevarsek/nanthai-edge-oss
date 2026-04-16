// convex/search/workflow_durable.ts
// =============================================================================
// Durable research paper pipeline — each phase runs as its own Convex action
// and schedules the next, so no single action risks the 10-minute timeout.
//
// State flows through the DB: each phase writes to `searchPhases` via
// `writeSearchPhase`, and the next phase reconstructs accumulated state by
// reading back those rows via `getSearchPhases`.
// =============================================================================

import { v, type PropertyValidators } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { ActionCtx } from "../_generated/server";
import {
  isGenerationCancelledError,
} from "../chat/generation_helpers";
import { resolveComplexityPreset, SearchResult } from "./helpers";
import {
  checkCancellation,
  PipelineArgs,
  updateSession,
} from "./workflow_shared";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import {
  runPlanningPhase,
  runInitialSearchPhase,
  runAnalysisPhase,
  runDepthSearchPhase,
  runSynthesisPhase,
} from "./workflow_nonstream_phases";
import { runPaperGenerationPhase } from "./workflow_paper_phase";

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
  subagentsEnabled: v.optional(v.boolean()),
  // Phase-specific: tracks where we are in the pipeline
  phaseOrder: v.number(),
  // For depth loop phases: which iteration we're on
  depthIteration: v.optional(v.number()),
} satisfies PropertyValidators;

// Phase action args are a superset of PipelineArgs (with extra phaseOrder,
// depthIteration). This helper picks the PipelineArgs subset so we avoid
// `as unknown as PipelineArgs` casts throughout.
function toPipelineArgs(args: PhaseActionArgs): PipelineArgs {
  return args;
}

// Inferred type from the validator — matches PipelineArgs plus phase fields.
type PhaseActionArgs = PipelineArgs & {
  phaseOrder: number;
  depthIteration?: number;
};

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
    const data = phase.data as { queries?: string[] };
    if (Array.isArray(data?.queries)) return data.queries;
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
): Promise<void> {
  const errorMessage =
    error instanceof Error ? error.message : "Unknown research paper error";
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

  try {
    await updateSession(ctx, args.sessionId, {
      status: wasCancelled ? "cancelled" : "failed",
      currentPhase: wasCancelled ? "cancelled" : "failed",
      errorMessage: wasCancelled ? undefined : errorMessage,
      completedAt: Date.now(),
    });
  } catch (sessionError) {
    console.error(
      "[researchPaperDurable] Failed to update search session on error:",
      sessionError instanceof Error ? sessionError.message : String(sessionError),
    );
  }
}

// -- Phase 1: Planning --------------------------------------------------------

export const runPlanningAction = internalAction({
  args: phaseActionArgs,
  handler: async (ctx, args) => {
    try {
      const apiKey = await getRequiredUserOpenRouterApiKey(ctx, args.userId);
      const pipelineArgs = toPipelineArgs(args);
      const argsWithApiKey = { ...pipelineArgs, apiKey };
      const preset = resolveComplexityPreset("paper", args.complexity);

      await checkCancellation(ctx, args.sessionId);
      await runPlanningPhase(ctx, argsWithApiKey, preset.breadth, args.phaseOrder);

      // Schedule next: initial search
      await ctx.scheduler.runAfter(
        0,
        internal.search.workflow_durable.runInitialSearchAction,
        { ...args, phaseOrder: args.phaseOrder + 1 },
      );
    } catch (error) {
      await handlePhaseError(ctx, toPipelineArgs(args), error);
    }
  },
});

// -- Phase 2: Initial Search --------------------------------------------------

export const runInitialSearchAction = internalAction({
  args: phaseActionArgs,
  handler: async (ctx, args) => {
    try {
      const apiKey = await getRequiredUserOpenRouterApiKey(ctx, args.userId);
      const pipelineArgs = toPipelineArgs(args);
      const argsWithApiKey = { ...pipelineArgs, apiKey };
      const preset = resolveComplexityPreset("paper", args.complexity);

      // Read queries from persisted planning phase
      const queries = await readQueriesFromPhase(ctx, args.sessionId, "planning");
      if (queries.length === 0) {
        throw new Error("No queries found from planning phase");
      }

      await checkCancellation(ctx, args.sessionId);
      await runInitialSearchPhase(
        ctx,
        argsWithApiKey,
        queries,
        preset.searchModel,
        args.phaseOrder,
      );

      // Determine next step: depth loop or synthesis
      const depthIterations = preset.depth - 1;
      if (depthIterations > 0) {
        // Start depth loop: analysis phase for iteration 0
        await ctx.scheduler.runAfter(
          0,
          internal.search.workflow_durable.runAnalysisAction,
          { ...args, phaseOrder: args.phaseOrder + 1, depthIteration: 0 },
        );
      } else {
        // Skip depth loop, go straight to synthesis
        await ctx.scheduler.runAfter(
          0,
          internal.search.workflow_durable.runSynthesisAction,
          { ...args, phaseOrder: args.phaseOrder + 1 },
        );
      }
    } catch (error) {
      await handlePhaseError(ctx, toPipelineArgs(args), error);
    }
  },
});

// -- Phase 3a: Analysis (depth loop) ------------------------------------------

export const runAnalysisAction = internalAction({
  args: phaseActionArgs,
  handler: async (ctx, args) => {
    try {
      const apiKey = await getRequiredUserOpenRouterApiKey(ctx, args.userId);
      const pipelineArgs = toPipelineArgs(args);
      const argsWithApiKey = { ...pipelineArgs, apiKey };
      const preset = resolveComplexityPreset("paper", args.complexity);
      const iteration = args.depthIteration ?? 0;

      // Reconstruct all search results accumulated so far
      const allSearchResults = await reconstructSearchResults(ctx, args.sessionId);

      await checkCancellation(ctx, args.sessionId);
      await runAnalysisPhase(
        ctx,
        argsWithApiKey,
        allSearchResults,
        preset.breadth,
        args.phaseOrder,
        iteration,
      );

      // Schedule next: depth search for this iteration
      await ctx.scheduler.runAfter(
        0,
        internal.search.workflow_durable.runDepthSearchAction,
        { ...args, phaseOrder: args.phaseOrder + 1 },
      );
    } catch (error) {
      await handlePhaseError(ctx, toPipelineArgs(args), error);
    }
  },
});

// -- Phase 3b: Depth Search (depth loop) --------------------------------------

export const runDepthSearchAction = internalAction({
  args: phaseActionArgs,
  handler: async (ctx, args) => {
    try {
      const apiKey = await getRequiredUserOpenRouterApiKey(ctx, args.userId);
      const pipelineArgs = toPipelineArgs(args);
      const argsWithApiKey = { ...pipelineArgs, apiKey };
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

      await checkCancellation(ctx, args.sessionId);
      await runDepthSearchPhase(
        ctx,
        argsWithApiKey,
        queries,
        preset.searchModel,
        args.phaseOrder,
        iteration,
      );

      // More depth iterations?
      const depthIterations = preset.depth - 1;
      const nextIteration = iteration + 1;
      if (nextIteration < depthIterations) {
        // Continue depth loop: next analysis
        await ctx.scheduler.runAfter(
          0,
          internal.search.workflow_durable.runAnalysisAction,
          { ...args, phaseOrder: args.phaseOrder + 1, depthIteration: nextIteration },
        );
      } else {
        // Depth loop done, move to synthesis
        await ctx.scheduler.runAfter(
          0,
          internal.search.workflow_durable.runSynthesisAction,
          { ...args, phaseOrder: args.phaseOrder + 1 },
        );
      }
    } catch (error) {
      await handlePhaseError(ctx, toPipelineArgs(args), error);
    }
  },
});

// -- Phase 4: Synthesis -------------------------------------------------------

export const runSynthesisAction = internalAction({
  args: phaseActionArgs,
  handler: async (ctx, args) => {
    try {
      const apiKey = await getRequiredUserOpenRouterApiKey(ctx, args.userId);
      const pipelineArgs = toPipelineArgs(args);
      const argsWithApiKey = { ...pipelineArgs, apiKey };

      // Reconstruct all accumulated search results (with citations)
      const allSearchResults = await reconstructSearchResults(ctx, args.sessionId);

      await checkCancellation(ctx, args.sessionId);
      await runSynthesisPhase(
        ctx,
        argsWithApiKey,
        allSearchResults,
        args.phaseOrder,
      );

      // Schedule final phase: paper generation handoff
      await ctx.scheduler.runAfter(
        0,
        internal.search.workflow_durable.runPaperHandoffAction,
        { ...args, phaseOrder: args.phaseOrder + 1 },
      );
    } catch (error) {
      await handlePhaseError(ctx, toPipelineArgs(args), error);
    }
  },
});

// -- Phase 5: Paper Generation Handoff ----------------------------------------

export const runPaperHandoffAction = internalAction({
  args: phaseActionArgs,
  handler: async (ctx, args) => {
    const pipelineArgs = toPipelineArgs(args);
    try {
      const preset = resolveComplexityPreset("paper", args.complexity);

      // Reconstruct all search results for the search context
      const allSearchResults = await reconstructSearchResults(ctx, args.sessionId);

      // Read synthesis data from persisted phase
      const phases = await ctx.runQuery(
        internal.search.queries.getSearchPhases,
        { sessionId: args.sessionId },
      );
      const synthesisPhase = [...phases].reverse().find(
        (p) => p.phaseType === "synthesis",
      );
      if (!synthesisPhase) {
        throw new Error("No synthesis phase found — cannot generate paper");
      }
      const synthesisData =
        typeof synthesisPhase.data === "string"
          ? synthesisPhase.data
          : JSON.stringify(synthesisPhase.data);

      // Persist search context on the message (queries + full results with citations)
      const searchContext = {
        complexity: args.complexity,
        queries: allSearchResults.map((r) => r.query),
        searchResults: allSearchResults,
      };
      await ctx.runMutation(internal.search.mutations.patchMessageSearchContext, {
        messageId: args.assistantMessageId,
        chatId: args.chatId,
        userId: args.userId,
        mode: "paper",
        searchContext,
      });

      await checkCancellation(ctx, args.sessionId);
      await runPaperGenerationPhase(ctx, pipelineArgs, synthesisData, args.phaseOrder);

      // Write search stats — runGeneration (scheduled inside
      // runPaperGenerationPhase) will mark the session completed/failed.
      await updateSession(ctx, args.sessionId, {
        searchCallCount: allSearchResults.length,
        perplexityModelTier: preset.searchModel,
        participantCount: 1,
      });
    } catch (error) {
      await handlePhaseError(ctx, pipelineArgs, error);
    }
  },
});
