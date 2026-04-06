// convex/search/workflow.ts
// =============================================================================
// Stable research paper workflow registration.
// Keep exported function IDs here; implementation is extracted to helpers.
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

const researchPaperPipelineArgs = {
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
} satisfies PropertyValidators;

export const researchPaperPipeline = internalAction({
  args: researchPaperPipelineArgs,
  handler: researchPaperPipelineHandler,
});

async function researchPaperPipelineHandler(
  ctx: ActionCtx,
  args: PipelineArgs,
): Promise<void> {
  await ctx.runMutation(internal.chat.mutations.updateJobStatus, {
    jobId: args.jobId,
    status: "streaming",
    startedAt: Date.now(),
  });

  try {
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, args.userId);
    const argsWithApiKey = { ...args, apiKey };
    const preset = resolveComplexityPreset("paper", args.complexity);
    let phaseOrder = 0;

    await checkCancellation(ctx, args.sessionId);
    const planning = await runPlanningPhase(ctx, argsWithApiKey, preset.breadth, phaseOrder);
    phaseOrder++;

    await checkCancellation(ctx, args.sessionId);
    const initialResults = await runInitialSearchPhase(
      ctx,
      argsWithApiKey,
      planning.queries,
      preset.searchModel,
      phaseOrder,
    );
    phaseOrder++;

    let allSearchResults: SearchResult[] = [...initialResults];
    const depthIterations = preset.depth - 1;

    for (let i = 0; i < depthIterations; i++) {
      await checkCancellation(ctx, args.sessionId);

      const analysis = await runAnalysisPhase(
        ctx,
        argsWithApiKey,
        allSearchResults,
        preset.breadth,
        phaseOrder,
        i,
      );
      phaseOrder++;

      await checkCancellation(ctx, args.sessionId);

      const depthResults = await runDepthSearchPhase(
        ctx,
        argsWithApiKey,
        analysis.queries,
        preset.searchModel,
        phaseOrder,
        i,
      );
      phaseOrder++;

      allSearchResults = [...allSearchResults, ...depthResults];
    }

    await checkCancellation(ctx, args.sessionId);
    const synthesis = await runSynthesisPhase(
      ctx,
      argsWithApiKey,
      allSearchResults,
      phaseOrder,
    );
    phaseOrder++;

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
    await runPaperGenerationPhase(ctx, args, synthesis, phaseOrder);

    // Write search stats but keep status as "writing" — runGeneration
    // (scheduled inside runPaperGenerationPhase) will mark the session
    // "completed" or "failed" when generation actually finishes.
    await updateSession(ctx, args.sessionId, {
      searchCallCount: allSearchResults.length,
      perplexityModelTier: preset.searchModel,
      participantCount: 1,
    });

    // Note: postProcess is now handled by runGeneration (scheduled inside
    // runPaperGenerationPhase), so we don't schedule it here.

    // Note: Push notification fires in finalizeGenerationHandler for
    // scheduled-job chats when generation actually completes.
  } catch (error) {
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
        "[researchPaperPipeline] Failed to update search session on error:",
        sessionError instanceof Error ? sessionError.message : String(sessionError),
      );
    }

    // Note: Push notification for failures fires in finalizeGenerationHandler
    // for scheduled-job chats (called above).
  }
}
