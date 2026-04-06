import { v, type PropertyValidators } from "convex/values";

export const listChatsArgs = {
  folderId: v.optional(v.string()),
  limit: v.optional(v.number()),
} satisfies PropertyValidators;

export const getChatArgs = {
  chatId: v.id("chats"),
} satisfies PropertyValidators;

export const listMessagesArgs = {
  chatId: v.id("chats"),
  limit: v.optional(v.number()),
  /** When set, only return messages with createdAt < this value (ms epoch). Cursor-based pagination aligned with the by_chat index. */
  before: v.optional(v.number()),
} satisfies PropertyValidators;

export const getMessageArgs = {
  messageId: v.id("messages"),
} satisfies PropertyValidators;

export const getStreamingContentArgs = {
  messageId: v.id("messages"),
} satisfies PropertyValidators;

export const listStreamingMessagesArgs = {
  chatId: v.id("chats"),
} satisfies PropertyValidators;

export const getGenerationStatusArgs = {
  jobId: v.id("generationJobs"),
} satisfies PropertyValidators;

export const getActiveJobsArgs = {
  chatId: v.id("chats"),
} satisfies PropertyValidators;

export const listAllMessagesArgs = {
  chatId: v.id("chats"),
} satisfies PropertyValidators;

export const getUserMemoriesArgs = {
  userId: v.string(),
} satisfies PropertyValidators;

export const getModelCapabilitiesArgs = {
  modelId: v.string(),
} satisfies PropertyValidators;

export const getPersonaArgs = {
  personaId: v.string(),
  userId: v.string(),
} satisfies PropertyValidators;

export const getChatInternalArgs = {
  chatId: v.id("chats"),
} satisfies PropertyValidators;

export const getMessageInternalArgs = {
  messageId: v.id("messages"),
} satisfies PropertyValidators;

export const getGenerationJobInternalArgs = {
  jobId: v.id("generationJobs"),
} satisfies PropertyValidators;

export const getUserPreferencesArgs = {
  userId: v.string(),
} satisfies PropertyValidators;

export const getAttachmentUrlArgs = {
  storageId: v.id("_storage"),
  messageId: v.id("messages"),
} satisfies PropertyValidators;

export const getMessageAudioUrlArgs = {
  messageId: v.id("messages"),
} satisfies PropertyValidators;

export const getGeneratedFilesByMessageArgs = {
  messageId: v.id("messages"),
} satisfies PropertyValidators;

export const getGeneratedChartsByMessageArgs = {
  messageId: v.id("messages"),
} satisfies PropertyValidators;

export const getSubagentBatchViewArgs = {
  messageId: v.id("messages"),
} satisfies PropertyValidators;

// MARK: - Knowledge Base (Phase KB)

export const listKnowledgeBaseFilesArgs = {
  search: v.optional(v.string()),
  source: v.optional(
    v.union(v.literal("upload"), v.literal("generated"), v.literal("all")),
  ),
  limit: v.optional(v.number()),
} satisfies PropertyValidators;

export const getKnowledgeBaseFilesByStorageIdsArgs = {
  storageIds: v.array(v.id("_storage")),
} satisfies PropertyValidators;

// ── Chat search (for search_chats AI tool) ─────────────────────────────

export const searchMessagesInternalArgs = {
  userId: v.string(),
  searchQuery: v.string(),
  limit: v.number(),
} satisfies PropertyValidators;

// ── M23: Advanced Stats ────────────────────────────────────────────────

export const getChatCostSummaryArgs = {
  chatId: v.id("chats"),
} satisfies PropertyValidators;
