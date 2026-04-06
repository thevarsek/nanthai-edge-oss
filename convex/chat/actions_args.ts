import { v, type PropertyValidators } from "convex/values";

export const participantConfigValidator = v.object({
  modelId: v.string(),
  personaId: v.optional(v.union(v.id("personas"), v.null())),
  personaName: v.optional(v.union(v.string(), v.null())),
  personaEmoji: v.optional(v.union(v.string(), v.null())),
  personaAvatarImageUrl: v.optional(v.union(v.string(), v.null())),
  systemPrompt: v.optional(v.union(v.string(), v.null())),
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  includeReasoning: v.optional(v.boolean()),
  reasoningEffort: v.optional(v.union(v.string(), v.null())),
  messageId: v.id("messages"),
  jobId: v.id("generationJobs"),
});

export const runGenerationArgs = {
  chatId: v.id("chats"),
  userMessageId: v.id("messages"),
  assistantMessageIds: v.array(v.id("messages")),
  generationJobIds: v.array(v.id("generationJobs")),
  participants: v.array(participantConfigValidator),
  userId: v.string(),
  expandMultiModelGroups: v.boolean(),
  webSearchEnabled: v.boolean(),
  // M10 Phase B — integration toggles (e.g. ["gmail", "drive", "calendar"])
  enabledIntegrations: v.optional(v.array(v.string())),
  subagentsEnabled: v.optional(v.boolean()),
  // Optional: when runGeneration is called from a search path (C/D/regen),
  // pass the sessionId so runGeneration can mark it completed/failed on finish.
  searchSessionId: v.optional(v.id("searchSessions")),
} satisfies PropertyValidators;

export const postProcessArgs = {
  chatId: v.id("chats"),
  userMessageId: v.id("messages"),
  assistantMessageIds: v.array(v.id("messages")),
  userId: v.string(),
} satisfies PropertyValidators;

export const generateTitleArgs = {
  chatId: v.id("chats"),
  sourceContent: v.string(),
  assistantContent: v.optional(v.string()),
  titleModel: v.optional(v.string()),
  seedTitle: v.optional(v.string()),
  userId: v.string(),
  messageId: v.optional(v.id("messages")), // M23: for ancillary cost attribution
} satisfies PropertyValidators;

export const generateAudioForMessageArgs = {
  messageId: v.id("messages"),
  previewText: v.optional(v.string()),
  voiceOverride: v.optional(v.string()),
} satisfies PropertyValidators;

export const previewVoiceArgs = {
  voice: v.string(),
} satisfies PropertyValidators;

export const extractMemoriesArgs = {
  chatId: v.id("chats"),
  userMessageContent: v.string(),
  userMessageId: v.id("messages"),
  assistantMessageId: v.optional(v.id("messages")),
  assistantContent: v.string(),
  userId: v.string(),
  extractionModel: v.optional(v.string()),
  isPending: v.optional(v.boolean()),
} satisfies PropertyValidators;
