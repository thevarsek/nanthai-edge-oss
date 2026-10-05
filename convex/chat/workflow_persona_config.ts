import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { resolveEffectiveIntegrations } from "../skills/resolver";
import { getGenerationContextHandler } from "./queries_generation_context";
import type { GenerationParticipantWorkflowArgs } from "./workflow_contract";

export async function bindWorkflowPersonaConfig(
  ctx: MutationCtx,
  args: GenerationParticipantWorkflowArgs,
  job: Doc<"generationJobs">,
): Promise<GenerationParticipantWorkflowArgs> {
  const config = job.effectivePersonaConfig;
  if (!config) return args; // Historical executions retain their recorded arguments.
  const persona = await ctx.db.get(config.personaId);
  if (!persona || persona.userId !== job.userId) {
    throw new ConvexError({ code: "PERSONA_UNAVAILABLE", message: "This Persona is no longer available." });
  }
  const context = await getGenerationContextHandler(ctx, {
    userId: job.userId, chatId: job.chatId, messageId: job.messageId, personaIds: [],
  });
  const message = await ctx.db.get(job.messageId);
  const integrations = resolveEffectiveIntegrations({
    settingsDefaults: args.integrationDefaults,
    personaOverrides: config.integrationOverrides,
    chatOverrides: args.chatIntegrationOverrides,
    turnOverrides: message?.turnIntegrationOverrides
      ?? message?.enabledIntegrations?.map((integrationId) => ({ integrationId, enabled: true })),
    connectedIntegrationIds: context.connectedIntegrationIds,
  });
  return {
    ...args,
    participant: {
      ...args.participant, personaId: config.personaId, personaName: config.displayName,
      systemPrompt: config.systemPrompt, modelId: config.modelId ?? args.participant.modelId,
      temperature: config.temperature, maxTokens: config.maxTokens,
      includeReasoning: config.includeReasoning, reasoningEffort: config.reasoningEffort,
    },
    personaSkillOverrides: config.skillOverrides ?? [],
    effectiveIntegrations: integrations.effectiveIntegrations,
  };
}
