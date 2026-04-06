import { v } from "convex/values";

export const participantConfigValidator = v.object({
  participantId: v.string(),
  modelId: v.string(),
  personaId: v.optional(v.union(v.id("personas"), v.null())),
  displayName: v.string(),
  systemPrompt: v.optional(v.union(v.string(), v.null())),
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  includeReasoning: v.optional(v.boolean()),
  reasoningEffort: v.optional(v.union(v.string(), v.null())),
});

export const moderatorConfigValidator = v.object({
  modelId: v.string(),
  personaId: v.optional(v.union(v.id("personas"), v.null())),
  displayName: v.string(),
});
