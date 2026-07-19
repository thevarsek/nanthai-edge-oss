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
  createVideoOutputUploadSessionArgs,
  completeVideoOutputUploadArgs,
  finalizeGenerationArgs,
  insertGeneratedMediaArgs,
  markChatCompletionNotifiedArgs,
  patchMessageAudioArgs,
  reinforceMemoryArgs,
  requestAudioGenerationArgs,
  retryMessageArgs,
  saveGenerationContinuationArgs,
  settleVideoGenerationArgs,
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
  saveGenerationContinuationHandler,
  setGenerationContinuationScheduledHandler,
} from "./mutations_generation_continuation_handlers";
import {
  cancelActiveGenerationHandler,
  cancelGenerationHandler,
  createChatHandler,
  createUploadUrlHandler,
  requestAudioGenerationHandler,
  sendMessageHandler,
} from "./mutations_public_handlers";
import { retryMessageHandler } from "./mutations_retry_handler";
import {
  createMemoryHandler,
  finalizeGenerationHandler,
  markChatCompletionNotifiedHandler,
  patchMessageAudioHandler,
  storeGenerationUsageHandler,
  storeAncillaryCostHandler,
  updateChatTitleHandler,
  updateJobStatusHandler,
  updateMessageContentHandler,
  updateMessageReasoningHandler,
  updateMessageToolCallsHandler,
} from "./mutations_internal_handlers";
import {
  completeVideoOutputUploadHandler,
  createVideoJobHandler,
  createVideoOutputUploadSessionHandler,
  insertGeneratedMediaHandler,
  settleVideoGenerationHandler,
  markVideoProviderTerminalHandler,
  terminalizeParentGenerationExecution,
  updateVideoJobPollHandler,
  updateVideoJobStatusHandler,
} from "./video_mutation_handlers";
import {
  reinforceMemoryHandler,
  supersedeMemoryHandler,
  touchMemoriesHandler,
} from "./mutations_memory_lifecycle_handlers";
import { deleteKnowledgeBaseFileArgs } from "../knowledge_base/mutations_args";
import { deleteKnowledgeBaseFileHandler } from "../knowledge_base/mutations";
import { assertCurrentFence } from "../execution/control_plane";

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

/** Drain-compatible alias for generation groups started before M47. */
export const markPostProcessScheduled = internalMutation({
  args: { messageId: v.id("messages") },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.postProcessScheduledAt != null) return false;
    await ctx.db.patch(message._id, { postProcessScheduledAt: Date.now() });
    return true;
  },
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

export const markGenerationJobAnalyticsStarted = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if ((args.executionAttemptId === undefined) !== (args.executionFence === undefined)) {
      throw new Error("INCOMPLETE_EXECUTION_FENCE");
    }
    if (args.executionAttemptId && args.executionFence !== undefined) {
      await assertCurrentFence(ctx, args.executionAttemptId, args.executionFence);
    }
    const job = await ctx.db.get(args.jobId);
    if (!job || ["cancelled", "completed", "failed", "timedOut"].includes(job.status)) {
      return false;
    }

    if (job.analyticsStartedAt !== undefined) {
      return false;
    }

    await ctx.db.patch(args.jobId, {
      analyticsStartedAt: Date.now(),
    });
    return true;
  },
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

// KB — moved to `convex/knowledge_base/mutations.ts`. Keep wrapper for shipped
// clients that still call the old chat/* function ID.
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

export const createVideoOutputUploadSession = internalMutation({
  args: createVideoOutputUploadSessionArgs,
  handler: createVideoOutputUploadSessionHandler,
});

export const completeVideoOutputUpload = internalMutation({
  args: completeVideoOutputUploadArgs,
  returns: v.boolean(),
  handler: completeVideoOutputUploadHandler,
});

export const updateVideoJobStatus = internalMutation({
  args: updateVideoJobStatusArgs,
  handler: updateVideoJobStatusHandler,
});

export const updateVideoJobPoll = internalMutation({
  args: updateVideoJobPollArgs,
  handler: updateVideoJobPollHandler,
});

export const markVideoProviderTerminal = internalMutation({
  args: {
    videoJobId: v.id("videoJobs"),
    status: v.union(v.literal("completed"), v.literal("failed")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await markVideoProviderTerminalHandler(ctx, args);
    return null;
  },
});

export const insertGeneratedMedia = internalMutation({
  args: insertGeneratedMediaArgs,
  returns: v.id("generatedMedia"),
  handler: insertGeneratedMediaHandler,
});

export const settleVideoGeneration = internalMutation({
  args: settleVideoGenerationArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await settleVideoGenerationHandler(ctx, args);
    return null;
  },
});

export const closeVideoParentGeneration = internalMutation({
  args: {
    videoRunId: v.id("executionRuns"),
    generationJobId: v.id("generationJobs"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await terminalizeParentGenerationExecution(
      ctx,
      args.videoRunId,
      args.generationJobId,
    );
    return null;
  },
});
