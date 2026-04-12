// convex/chat/queries.ts
// =============================================================================
// Stable chat query registrations.
// =============================================================================

import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import {
  getActiveJobsArgs,
  getAttachmentUrlArgs,
  getGeneratedChartsByMessageArgs,
  getChatArgs,
  getChatCostSummaryArgs,
  getChatInternalArgs,
  getGeneratedFilesByMessageArgs,
  getGenerationJobInternalArgs,
  getGenerationStatusArgs,
  getMessageArgs,
  getMessageAudioUrlArgs,
  getMessageInternalArgs,
  getModelCapabilitiesArgs,
  getPersonaArgs,
  getStreamingContentArgs,
  getUserMemoriesArgs,
  getUserPreferencesArgs,
  getKnowledgeBaseFilesByStorageIdsArgs,
  listAllMessagesArgs,
  listChatsArgs,
  listKnowledgeBaseFilesArgs,
  listMessagesArgs,
  listStreamingMessagesArgs,
  searchMessagesInternalArgs,
} from "./queries_args";
import {
  getActiveJobsHandler,
  getAttachmentUrlHandler,
  getGeneratedChartsByMessageHandler,
  getChatHandler,
  getChatCostSummaryHandler,
  getChatInternalHandler,
  getGeneratedFilesByMessageHandler,
  getGenerationJobInternalHandler,
  getGenerationStatusHandler,
  getMessageHandler,
  getMessageAudioUrlHandler,
  getMessageInternalHandler,
  getModelCapabilitiesHandler,
  getPersonaHandler,
  getStreamingContentHandler,
  getUserMemoriesHandler,
  getUserPreferencesHandler,
  getKnowledgeBaseFilesByStorageIdsHandler,
  listAllMessagesHandler,
  listChatsHandler,
  listKnowledgeBaseFilesHandler,
  listMessagesHandler,
  listStreamingMessagesHandler,
  searchMessagesInternalHandler,
} from "./queries_handlers";
import { isJobCancelledArgs } from "./mutations_args";
import { isJobCancelledHandler } from "./mutations_internal_handlers";

export const listChats = query({
  args: listChatsArgs,
  handler: listChatsHandler,
});

export const getChat = query({
  args: getChatArgs,
  handler: getChatHandler,
});

export const listMessages = query({
  args: listMessagesArgs,
  handler: listMessagesHandler,
});

export const getMessage = query({
  args: getMessageArgs,
  handler: getMessageHandler,
});

export const getStreamingContent = query({
  args: getStreamingContentArgs,
  handler: getStreamingContentHandler,
});

export const listStreamingMessages = query({
  args: listStreamingMessagesArgs,
  handler: listStreamingMessagesHandler,
});

export const getGenerationStatus = query({
  args: getGenerationStatusArgs,
  handler: getGenerationStatusHandler,
});

export const getActiveJobs = query({
  args: getActiveJobsArgs,
  handler: getActiveJobsHandler,
});

export const getAttachmentUrl = query({
  args: getAttachmentUrlArgs,
  handler: getAttachmentUrlHandler,
});

export const getMessageAudioUrl = query({
  args: getMessageAudioUrlArgs,
  handler: getMessageAudioUrlHandler,
});

export const listAllMessages = internalQuery({
  args: listAllMessagesArgs,
  handler: listAllMessagesHandler,
});

export const getUserMemories = internalQuery({
  args: getUserMemoriesArgs,
  handler: getUserMemoriesHandler,
});

export const getModelCapabilities = internalQuery({
  args: getModelCapabilitiesArgs,
  handler: getModelCapabilitiesHandler,
});

export const getPersona = internalQuery({
  args: getPersonaArgs,
  handler: getPersonaHandler,
});

export const getChatInternal = internalQuery({
  args: getChatInternalArgs,
  handler: getChatInternalHandler,
});

export const getMessageInternal = internalQuery({
  args: getMessageInternalArgs,
  handler: getMessageInternalHandler,
});

export const getGenerationJobInternal = internalQuery({
  args: getGenerationJobInternalArgs,
  handler: getGenerationJobInternalHandler,
});

export const getUserPreferences = internalQuery({
  args: getUserPreferencesArgs,
  handler: getUserPreferencesHandler,
});

export const getGeneratedFilesByMessage = query({
  args: getGeneratedFilesByMessageArgs,
  handler: getGeneratedFilesByMessageHandler,
});

export const getGeneratedChartsByMessage = query({
  args: getGeneratedChartsByMessageArgs,
  handler: getGeneratedChartsByMessageHandler,
});

// MARK: - Knowledge Base (Phase KB)

export const listKnowledgeBaseFiles = query({
  args: listKnowledgeBaseFilesArgs,
  handler: listKnowledgeBaseFilesHandler,
});

export const getKnowledgeBaseFilesByStorageIds = query({
  args: getKnowledgeBaseFilesByStorageIdsArgs,
  handler: getKnowledgeBaseFilesByStorageIdsHandler,
});

// ── Chat search (for search_chats AI tool) ─────────────────────────────

export const searchMessagesInternal = internalQuery({
  args: searchMessagesInternalArgs,
  handler: searchMessagesInternalHandler,
});

// ── M23: Advanced Stats ────────────────────────────────────────────────

export const getChatCostSummary = query({
  args: getChatCostSummaryArgs,
  handler: getChatCostSummaryHandler,
});

// ── Generation job status (pure read) ──────────────────────────────────

export const isJobCancelled = internalQuery({
  args: isJobCancelledArgs,
  returns: v.boolean(),
  handler: isJobCancelledHandler,
});
