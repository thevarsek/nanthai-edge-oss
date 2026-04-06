import { internal } from "../_generated/api";
import { ActionCtx } from "../_generated/server";
import { buildPaperGenerationSystemPrompt } from "./helpers";
import { computeProgress, PipelineArgs, updateSession } from "./workflow_shared";

/**
 * Build the augmented system prompt for the paper generation phase, then hand
 * off to `runGeneration` (the full tool-aware pipeline) so the model gets
 * skills, progressive tool loading, memory, compaction, subagents, etc.
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
): Promise<void> {
  await updateSession(ctx, args.sessionId, {
    status: "writing",
    progress: computeProgress(args.complexity, "paper", 0),
    currentPhase: "writing",
    phaseOrder,
  });

  // Build the paper-generation system prompt from synthesis data.
  const paperSystemPrompt = buildPaperGenerationSystemPrompt(synthesisData);

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

  // Hand off to the full generation pipeline so the model gets skills,
  // progressive tool loading, memory, compaction, subagents, etc.
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
        systemPrompt: effectiveSystemPrompt,
        temperature: args.temperature ?? 0.4, // Paper generation default (lower than chat's 0.7)
        maxTokens: args.maxTokens,
        includeReasoning: args.includeReasoning,
        reasoningEffort: args.reasoningEffort ?? null,
        messageId: args.assistantMessageId,
        jobId: args.jobId,
      },
    ],
    userId: args.userId,
    expandMultiModelGroups: args.expandMultiModelGroups,
    webSearchEnabled: false, // Perplexity already searched
    enabledIntegrations: args.enabledIntegrations,
    subagentsEnabled: args.subagentsEnabled,
    searchSessionId: args.sessionId,
  });
}
