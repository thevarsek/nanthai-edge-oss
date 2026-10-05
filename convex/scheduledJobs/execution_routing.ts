import { personaSystemPrompt } from "../personas/default_prompt";
import { internal } from "../_generated/api";
import { ResolvedParticipant } from "./actions_types";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { internalQuery, type QueryCtx, type ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { activePersonaRuntimeBinding } from "../runtime_host/route_resolution";
import { getScheduledJobSteps, resolveScheduledJobSearchMode } from "./shared";

export async function requiresOpenRouterForExecution(
  ctx: QueryCtx,
  job: Doc<"scheduledJobs">,
): Promise<boolean> {
  for (const step of getScheduledJobSteps(job)) {
    const search = resolveScheduledJobSearchMode(step);
    if (!step.personaId || (search !== "none" && search !== "basic")) return true;
    const persona = await ctx.db.get(step.personaId);
    if (!persona || persona.userId !== job.userId) return true;
    if (!await activePersonaRuntimeBinding(ctx, persona)) return true;
  }
  return false;
}

export const requiresOpenRouter = internalQuery({
  args: { jobId: v.id("scheduledJobs") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    return job ? await requiresOpenRouterForExecution(ctx, job) : true;
  },
});

export async function resolveParticipant(
  ctx: ActionCtx,
  job: {
    modelId: string;
    personaId?: Id<"personas">;
    userId: string;
    includeReasoning?: boolean;
    reasoningEffort?: string;
  },
): Promise<ResolvedParticipant> {
  if (!job.personaId) {
    return {
      modelId: job.modelId,
      includeReasoning: job.includeReasoning ?? undefined,
      reasoningEffort: job.reasoningEffort ?? undefined,
    };
  }

  const persona = await ctx.runQuery(internal.chat.queries.getPersona, {
    personaId: job.personaId,
    userId: job.userId,
  });
  if (!persona) {
    return {
      modelId: job.modelId,
      includeReasoning: job.includeReasoning ?? undefined,
      reasoningEffort: job.reasoningEffort ?? undefined,
    };
  }

  return {
    modelId: persona.modelId ?? job.modelId,
    systemPrompt: personaSystemPrompt(persona.systemPrompt),
    temperature: persona.temperature ?? undefined,
    maxTokens: persona.maxTokens ?? undefined,
    personaId: job.personaId,
    personaName: persona.displayName ?? undefined,
    personaEmoji: persona.avatarEmoji ?? undefined,
    personaAvatarImageUrl: persona.avatarImageUrl ?? undefined,
    includeReasoning:
      job.includeReasoning ?? persona.includeReasoning ?? undefined,
    reasoningEffort:
      job.reasoningEffort ?? persona.reasoningEffort ?? undefined,
  };
}

