// convex/chat/mutations.ts
// =============================================================================
// Stable chat mutation registrations.
// Keep exported function IDs here; implementation is extracted to helpers.
// =============================================================================

import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import {
  cancelGenerationContinuationArgs,
  cancelActiveGenerationArgs,
  cancelGenerationArgs,
  claimGenerationContinuationArgs,
  clearGenerationContinuationArgs,
  createChatArgs,
  createMemoryArgs,
  createVideoJobArgs,
  deleteKnowledgeBaseFileArgs,
  finalizeGenerationArgs,
  insertGeneratedMediaArgs,
  markChatCompletionNotifiedArgs,
  markPostProcessScheduledArgs,
  patchMessageAudioArgs,
  reinforceMemoryArgs,
  requestAudioGenerationArgs,
  retryMessageArgs,
  saveGenerationContinuationArgs,
  sendMessageArgs,
  setGenerationContinuationScheduledArgs,
  storeGenerationUsageArgs,
  storeAncillaryCostArgs,
  supersedeMemoryArgs,
  touchMemoriesArgs,
  updateChatTitleArgs,
  updateJobStatusArgs,
  updateMessageContentArgs,
  updateMessageReasoningArgs,
  updateMessageToolCallsArgs,
  updateVideoJobPollArgs,
  updateVideoJobStatusArgs,
} from "./mutations_args";
import {
  cancelGenerationContinuationHandler,
  claimGenerationContinuationHandler,
  clearGenerationContinuationHandler,
  markPostProcessScheduledHandler,
  saveGenerationContinuationHandler,
  setGenerationContinuationScheduledHandler,
} from "./mutations_generation_continuation_handlers";
import {
  cancelActiveGenerationHandler,
  cancelGenerationHandler,
  createChatHandler,
  createUploadUrlHandler,
  deleteKnowledgeBaseFileHandler,
  requestAudioGenerationHandler,
  sendMessageHandler,
} from "./mutations_public_handlers";
import { retryMessageHandler } from "./mutations_retry_handler";
import {
  createMemoryHandler,
  createVideoJobHandler,
  finalizeGenerationHandler,
  insertGeneratedMediaHandler,
  markChatCompletionNotifiedHandler,
  patchMessageAudioHandler,
  storeGenerationUsageHandler,
  storeAncillaryCostHandler,
  updateChatTitleHandler,
  updateJobStatusHandler,
  updateMessageContentHandler,
  updateMessageReasoningHandler,
  updateMessageToolCallsHandler,
  updateVideoJobPollHandler,
  updateVideoJobStatusHandler,
} from "./mutations_internal_handlers";
import {
  reinforceMemoryHandler,
  supersedeMemoryHandler,
  touchMemoriesHandler,
} from "./mutations_memory_lifecycle_handlers";

export const createChat = mutation({
  args: createChatArgs,
  returns: v.id("chats"),
  handler: createChatHandler,
});

export const createUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: createUploadUrlHandler,
});

export const sendMessage = mutation({
  args: sendMessageArgs,
  returns: v.object({
    userMessageId: v.id("messages"),
    assistantMessageIds: v.array(v.id("messages")),
  }),
  handler: sendMessageHandler,
});

export const cancelGeneration = mutation({
  args: cancelGenerationArgs,
  handler: cancelGenerationHandler,
});

export const cancelActiveGeneration = mutation({
  args: cancelActiveGenerationArgs,
  returns: v.object({ cancelledCount: v.number() }),
  handler: cancelActiveGenerationHandler,
});

export const retryMessage = mutation({
  args: retryMessageArgs,
  returns: v.object({
    assistantMessageIds: v.array(v.id("messages")),
  }),
  handler: retryMessageHandler,
});

export const requestAudioGeneration = mutation({
  args: requestAudioGenerationArgs,
  returns: v.object({ scheduled: v.literal(true), alreadyExists: v.optional(v.boolean()) }),
  handler: requestAudioGenerationHandler,
});

export const updateMessageContent = internalMutation({
  args: updateMessageContentArgs,
  handler: updateMessageContentHandler,
});

export const updateMessageReasoning = internalMutation({
  args: updateMessageReasoningArgs,
  handler: updateMessageReasoningHandler,
});

export const markChatCompletionNotified = internalMutation({
  args: markChatCompletionNotifiedArgs,
  returns: v.boolean(),
  handler: markChatCompletionNotifiedHandler,
});

export const markPostProcessScheduled = internalMutation({
  args: markPostProcessScheduledArgs,
  returns: v.boolean(),
  handler: markPostProcessScheduledHandler,
});

export const patchMessageAudio = internalMutation({
  args: patchMessageAudioArgs,
  handler: patchMessageAudioHandler,
});

// Clears the audioGenerating flag if TTS generation fails, so the user can retry.
export const clearAudioGenerating = internalMutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { audioGenerating: undefined });
  },
});

// M10 — Live tool-call streaming: progressively patch toolCalls during generation.
export const updateMessageToolCalls = internalMutation({
  args: updateMessageToolCallsArgs,
  handler: updateMessageToolCallsHandler,
});

export const finalizeGeneration = internalMutation({
  args: finalizeGenerationArgs,
  handler: finalizeGenerationHandler,
});

export const updateJobStatus = internalMutation({
  args: updateJobStatusArgs,
  handler: updateJobStatusHandler,
});

export const saveGenerationContinuation = internalMutation({
  args: saveGenerationContinuationArgs,
  handler: saveGenerationContinuationHandler,
});

export const claimGenerationContinuation = internalMutation({
  args: claimGenerationContinuationArgs,
  returns: v.union(v.any(), v.null()),
  handler: claimGenerationContinuationHandler,
});

export const setGenerationContinuationScheduled = internalMutation({
  args: setGenerationContinuationScheduledArgs,
  handler: setGenerationContinuationScheduledHandler,
});

export const clearGenerationContinuation = internalMutation({
  args: clearGenerationContinuationArgs,
  handler: clearGenerationContinuationHandler,
});

export const cancelGenerationContinuation = internalMutation({
  args: cancelGenerationContinuationArgs,
  handler: cancelGenerationContinuationHandler,
});

// isJobCancelled moved to queries.ts as internalQuery (pure read, no writes).

export const updateChatTitle = internalMutation({
  args: updateChatTitleArgs,
  handler: updateChatTitleHandler,
});

export const createMemory = internalMutation({
  args: createMemoryArgs,
  returns: v.id("memories"),
  handler: createMemoryHandler,
});

export const reinforceMemory = internalMutation({
  args: reinforceMemoryArgs,
  handler: reinforceMemoryHandler,
});

export const supersedeMemory = internalMutation({
  args: supersedeMemoryArgs,
  handler: supersedeMemoryHandler,
});

export const touchMemories = internalMutation({
  args: touchMemoriesArgs,
  handler: touchMemoriesHandler,
});

// KB — Delete a file from the user's knowledge base (generated or uploaded).
export const deleteKnowledgeBaseFile = mutation({
  args: deleteKnowledgeBaseFileArgs,
  handler: deleteKnowledgeBaseFileHandler,
});

// Stores authoritative usage data fetched from the OpenRouter Generations API.
export const storeGenerationUsage = internalMutation({
  args: storeGenerationUsageArgs,
  handler: storeGenerationUsageHandler,
});

// M23: Stores ancillary (non-generation) API usage costs.
export const storeAncillaryCost = internalMutation({
  args: storeAncillaryCostArgs,
  handler: storeAncillaryCostHandler,
});

// ── M29: Video Generation ─────────────────────────────────────────────

export const createVideoJob = internalMutation({
  args: createVideoJobArgs,
  returns: v.id("videoJobs"),
  handler: createVideoJobHandler,
});

export const updateVideoJobStatus = internalMutation({
  args: updateVideoJobStatusArgs,
  handler: updateVideoJobStatusHandler,
});

export const updateVideoJobPoll = internalMutation({
  args: updateVideoJobPollArgs,
  handler: updateVideoJobPollHandler,
});

export const insertGeneratedMedia = internalMutation({
  args: insertGeneratedMediaArgs,
  returns: v.id("generatedMedia"),
  handler: insertGeneratedMediaHandler,
});
