import { type Infer, v } from "convex/values";
import { analyticsClientMetadataValidator } from "../analytics/client_metadata";
import { advisorSelection } from "../advisors/validators";
import {
  imageConfigValidator,
  videoConfigValidator,
} from "../chat/actions_args";
import {
  integrationOverrideEntry,
  retryContract,
  skillOverrideEntry,
} from "../schema_validators";

export const groupBehavior = v.union(
  v.literal("parallel"),
  v.literal("collaboration"),
);

export const collaborationExchangeStatus = v.union(
  v.literal("queued"),
  v.literal("scheduling"),
  v.literal("dispatching"),
  v.literal("waiting"),
  v.literal("silent"),
  v.literal("completed"),
  v.literal("limit_reached"),
  v.literal("stopped"),
  v.literal("failed"),
);

export const collaborationDecisionStatus = v.union(
  v.literal("selected"),
  v.literal("dispatched"),
  v.literal("settled"),
  v.literal("silent"),
  v.literal("failed"),
);

export const collaborationParticipantSnapshot = v.object({
  participantId: v.id("chatParticipants"),
  modelId: v.string(),
  personaId: v.optional(v.id("personas")),
  displayName: v.string(),
  personaEmoji: v.optional(v.string()),
  personaAvatarImageUrl: v.optional(v.string()),
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  includeReasoning: v.optional(v.boolean()),
  reasoningEffort: v.optional(v.string()),
});

export const collaborationGenerationSnapshot = v.object({
  expandMultiModelGroups: v.boolean(),
  webSearchEnabled: v.boolean(),
  enabledIntegrations: v.optional(v.array(v.string())),
  subagentsEnabled: v.optional(v.boolean()),
  turnSkillOverrides: v.optional(v.array(skillOverrideEntry)),
  turnIntegrationOverrides: v.optional(v.array(integrationOverrideEntry)),
  videoConfig: v.optional(videoConfigValidator),
  imageConfig: v.optional(imageConfigValidator),
  analytics: v.optional(analyticsClientMetadataValidator),
  advisorSelections: v.optional(v.array(advisorSelection)),
  advisorBrief: v.optional(v.string()),
  retryContract: v.optional(retryContract),
});

export const collaborationSelection = v.object({
  participantId: v.id("chatParticipants"),
  replyToMessageIds: v.array(v.id("messages")),
  reasonCode: v.string(),
});

export const collaborationBounds = v.object({
  maxWaves: v.number(),
  maxParticipantMessages: v.number(),
  deadlineAt: v.number(),
});

export const collaborationExecutionRef = v.object({
  runId: v.id("executionRuns"),
  attemptId: v.id("executionAttempts"),
  fence: v.number(),
  claimantId: v.string(),
});

export type GroupBehavior = Infer<typeof groupBehavior>;
export type CollaborationParticipantSnapshot = Infer<
  typeof collaborationParticipantSnapshot
>;
export type CollaborationGenerationSnapshot = Infer<
  typeof collaborationGenerationSnapshot
>;
export type CollaborationSelection = Infer<typeof collaborationSelection>;
export type CollaborationExecutionRef = Infer<typeof collaborationExecutionRef>;
