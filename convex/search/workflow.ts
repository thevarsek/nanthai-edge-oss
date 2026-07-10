// convex/search/workflow.ts
// =============================================================================
// Stable research paper workflow registration.
//
// The entry-point action (`researchPaperPipeline`) validates prerequisites and
// then schedules the first durable phase action. Each phase runs as its own
// Convex action, persists results to `searchPhases`, and schedules the next
// phase — so no single action risks the 10-minute timeout.
//
// See `workflow_durable.ts` for the per-phase actions.
// =============================================================================

import { v, type PropertyValidators } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { ActionCtx } from "../_generated/server";
import {
  isGenerationCancelledError,
} from "../chat/generation_helpers";
import {
  captureAssistantResponseFailure,
  captureAssistantResponseStartedEvent,
} from "../chat/generation_analytics";
import {
  checkCancellation,
  formatResearchPaperFailureMessage,
  PipelineArgs,
  updateSession,
} from "./workflow_shared";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { integrationOverrideEntry } from "../schema_validators";
import { analyticsClientMetadataValidator } from "../analytics/client_metadata";
import { analyticsSourceValidator } from "../chat/actions_args";
import {
  assertModelAvailable,
  assertTextGenerationModel,
} from "../lib/openrouter_modality";

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
  turnIntegrationOverrides: v.optional(v.array(integrationOverrideEntry)),
  subagentsEnabled: v.optional(v.boolean()),
  analytics: v.optional(analyticsClientMetadataValidator),
  analyticsSource: v.optional(analyticsSourceValidator),
} satisfies PropertyValidators;

export const researchPaperPipeline = internalAction({
  args: researchPaperPipelineArgs,
  handler: researchPaperPipelineHandler,
});

/**
 * Entry point: validate prerequisites, then schedule the first durable phase.
 *
 * Previously this function ran all research phases (planning → search →
 * analysis → depth → synthesis → paper) sequentially in a single action.
 * Now each phase is its own action in `workflow_durable.ts`, with state
 * flowing through the `searchPhases` table.
 */
async function researchPaperPipelineHandler(
  ctx: ActionCtx,
  args: PipelineArgs,
): Promise<void> {
  const workflowStartedAt = Date.now();
  try {
    await ctx.runMutation(internal.chat.mutations.updateJobStatus, {
      jobId: args.jobId,
      status: "streaming",
      startedAt: Date.now(),
    });
    const alreadyCancelled = await ctx.runQuery(
      internal.chat.queries.isJobCancelled,
      { jobId: args.jobId },
    );
    if (alreadyCancelled) {
      await ctx.runMutation(internal.advisors.mutations_internal.completeBatchForMessage, {
        messageId: args.assistantMessageId,
      });
      return;
    }
    // Validate API key early so we fail fast before scheduling anything
    await getRequiredUserOpenRouterApiKey(ctx, args.userId);
    const capabilities = await ctx.runQuery(
      internal.chat.queries.getModelCapabilities,
      { modelId: args.modelId },
    );
    assertModelAvailable({
      modelId: args.modelId,
      capabilities,
      feature: "Research paper generation",
    });
    assertTextGenerationModel({
      feature: "Research paper generation",
      hasImageGeneration: capabilities?.hasImageGeneration,
      hasVideoGeneration: capabilities?.hasVideoGeneration,
      hasAudioOutput: capabilities?.hasAudioOutput,
    });

    await checkCancellation(ctx, args.sessionId);

    // Schedule the first durable phase: planning
    await ctx.scheduler.runAfter(
      0,
      internal.search.workflow_durable.runPlanningAction,
      {
        ...args,
        phaseOrder: 0,
      },
    );
  } catch (error) {
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
      durationMs: Date.now() - workflowStartedAt,
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
      });
    } catch (sessionError) {
      console.error(
        "[researchPaperPipeline] Failed to update search session on error:",
        sessionError instanceof Error ? sessionError.message : String(sessionError),
      );
    }
  }
}
