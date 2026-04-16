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
  checkCancellation,
  PipelineArgs,
  updateSession,
} from "./workflow_shared";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";

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
  await ctx.runMutation(internal.chat.mutations.updateJobStatus, {
    jobId: args.jobId,
    status: "streaming",
    startedAt: Date.now(),
  });

  try {
    // Validate API key early so we fail fast before scheduling anything
    await getRequiredUserOpenRouterApiKey(ctx, args.userId);

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
  }
}
