import { v } from "convex/values";

export const advisorBatchStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("synthesizing"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const advisorRunStatus = v.union(
  v.literal("queued"),
  v.literal("preparing_context"),
  v.literal("consulting"),
  v.literal("streaming"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("timedOut"),
  v.literal("cancelled"),
);

export const advisorRunStage = v.union(
  v.literal("queued"),
  v.literal("preparing_context"),
  v.literal("consulting"),
  v.literal("streaming"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("timed_out"),
  v.literal("cancelled"),
);

export const advisorPersonaSnapshot = v.object({
  displayName: v.string(),
  avatarEmoji: v.optional(v.string()),
  avatarImageUrl: v.optional(v.string()),
  avatarSFSymbol: v.optional(v.string()),
  avatarColor: v.optional(v.string()),
  modelId: v.optional(v.string()),
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  includeReasoning: v.optional(v.boolean()),
  reasoningEffort: v.optional(v.string()),
});

export const advisorSelection = v.object({
  personaId: v.id("personas"),
  keepAvailable: v.boolean(),
  allowWebSearch: v.boolean(),
});

export const chatAdvisorInput = v.object({
  personaId: v.id("personas"),
  allowWebSearch: v.boolean(),
});

export const advisorEligibilityReason = v.union(
  v.literal("not_pro"),
  v.literal("zdr_enabled"),
  v.literal("google_protected"),
  v.literal("media_output_turn"),
  v.literal("participant_conflict"),
  v.literal("unsupported_turn"),
  v.literal("no_capacity"),
);

export const advisorPersonaUnavailableReason = v.union(
  v.literal("participant_conflict"),
  v.literal("model_unavailable"),
  v.literal("media_output_model"),
);

export const advisorUsage = v.object({
  promptTokens: v.number(),
  completionTokens: v.number(),
  totalTokens: v.number(),
  cost: v.optional(v.number()),
  isByok: v.optional(v.boolean()),
  upstreamInferenceCost: v.optional(v.number()),
});
