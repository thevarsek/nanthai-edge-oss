import { internal } from "../_generated/api";
import { ActionCtx } from "../_generated/server";
import {
  buildPaperGenerationSystemPrompt,
  resolveComplexityPreset,
} from "./helpers";
import {
  computeProgress,
  PipelineArgs,
  updateSession,
} from "./workflow_shared";

/**
 * Build the augmented system prompt for the paper generation phase, then hand
 * off to `runGeneration` in controlled compiler mode. The final paper writer
 * should draft from research artifacts rather than invoke chat skills/tools.
 *
 * Previously this function did its own `callOpenRouterStreaming` + tool loop
 * inline.  Now it mirrors Path C (web search): bake the synthesis data into
 * the system prompt, schedule `runGeneration`, and return.  The caller
 * (`researchPaperPipeline` in workflow.ts) marks the session completed and
 * skips its own `postProcess` scheduling (handled by `runGeneration`).
 */
export async function runPaperGenerationPhase(
  ctx: ActionCtx,
  args: PipelineArgs,
  synthesisData: string,
  phaseOrder: number,
  artifacts: { planningData?: string | null; architectureData?: string | null } = {},
): Promise<void> {
  await updateSession(ctx, args.sessionId, {
    status: "writing",
    progress: computeProgress(args.complexity, "paper", 0),
    currentPhase: "writing",
    phaseOrder,
  }, args);

  // Build the paper-generation system prompt from synthesis data.
  const paperSystemPrompt = buildPaperGenerationSystemPrompt(synthesisData, {
    planningData: artifacts.planningData ?? undefined,
    architectureData: artifacts.architectureData ?? undefined,
    complexity: args.complexity,
  });

  let effectiveSystemPrompt = paperSystemPrompt;
  if (args.systemPrompt) {
    effectiveSystemPrompt = `${args.systemPrompt}\n\n${paperSystemPrompt}`;
  } else if (args.personaId) {
    const persona = await ctx.runQuery(internal.chat.queries.getPersona, {
      personaId: args.personaId,
      userId: args.userId,
    });
    if (persona?.systemPrompt) {
      effectiveSystemPrompt = `${persona.systemPrompt}\n\n${paperSystemPrompt}`;
    }
  }

  // Hand off to the generation pipeline with tools disabled so base chat
  // utilities such as load_skill/fetch_image cannot steer autonomous drafting.
  // The job status is already "streaming" — runGeneration will re-set it
  // (idempotent) and handle finalization, post-processing, and tool loops.
  const generationArgs = {
    chatId: args.chatId,
    userMessageId: args.userMessageId,
    assistantMessageIds: [args.assistantMessageId],
    generationJobIds: [args.jobId],
    participants: [
      {
        modelId: args.modelId,
        personaId: args.personaId ?? null,
        systemPrompt: effectiveSystemPrompt,
        temperature: args.temperature ?? 0.4, // Paper generation default (lower than chat's 0.7)
        maxTokens: args.maxTokens,
        includeReasoning: false,
        reasoningEffort: null,
        messageId: args.assistantMessageId,
        jobId: args.jobId,
      },
    ],
    userId: args.userId,
    expandMultiModelGroups: args.expandMultiModelGroups,
    webSearchEnabled: false, // Perplexity already searched
    enabledIntegrations: args.enabledIntegrations,
    turnIntegrationOverrides: args.turnIntegrationOverrides,
    subagentsEnabled: args.subagentsEnabled,
    disableTools: true,
    searchSessionId: args.sessionId,
    analytics: args.analytics,
    analyticsSource: args.analyticsSource ?? "research_paper",
  };
  const preset = resolveComplexityPreset("paper", args.complexity);
  await ctx.runMutation(
    internal.search.generation_handoff.commitGenerationHandoff,
    {
      sessionId: args.sessionId,
      generationArgs,
      progress: computeProgress(args.complexity, "paper", 0),
      searchCallCount: 0,
      perplexityModelTier: preset.searchModel,
      participantCount: 1,
      executionAttemptId: args.executionAttemptId,
      executionFence: args.executionFence,
    },
  );
}
