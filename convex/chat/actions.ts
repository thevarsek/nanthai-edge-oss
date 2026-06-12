// convex/chat/actions.ts
// =============================================================================
// Stable public/internal action registrations for chat generation pipeline.
// Implementation lives in helper modules so this file keeps function IDs stable
// while remaining small and auditable.
// =============================================================================

"use node";

import { action, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { analyticsClientMetadataValidator } from "../analytics/client_metadata";
import {
  extractMemoriesArgs,
  generateAudioForMessageArgs,
  generateTitleArgs,
  postProcessArgs,
  previewVoiceArgs,
  pollVideoGenerationArgs,
  runGenerationArgs,
  runGenerationParticipantArgs,
  submitVideoGenerationArgs,
} from "./actions_args";
import {
  generateAudioForMessageHandler,
  previewVoiceHandler,
} from "./audio_actions";
import { extractMemoriesHandler } from "./actions_extract_memories_handler";
import { generateTitleHandler } from "./actions_generate_title_handler";
import { postProcessHandler } from "./actions_post_process_handler";
import { runGenerationHandler } from "./actions_run_generation_handler";
import { runGenerationParticipantHandler } from "./actions_run_generation_participant_action";
import { submitVideoGenerationHandler, pollVideoGenerationHandler } from "./actions_video_generation";
import { fetchAndStoreGenerationUsageHandler } from "./actions_fetch_usage";
import {
  captureAssistantResponseFailure,
  captureAssistantResponseStartedEvent,
} from "./generation_analytics";

export const runGeneration = internalAction({
  args: runGenerationArgs,
  handler: runGenerationHandler,
});

export const runGenerationParticipant = internalAction({
  args: runGenerationParticipantArgs,
  handler: runGenerationParticipantHandler,
});

export const postProcess = internalAction({
  args: postProcessArgs,
  handler: postProcessHandler,
});

export const generateTitle = internalAction({
  args: generateTitleArgs,
  handler: generateTitleHandler,
});

export const generateAudioForMessage = internalAction({
  args: generateAudioForMessageArgs,
  handler: generateAudioForMessageHandler,
});

export const extractMemories = internalAction({
  args: extractMemoriesArgs,
  handler: extractMemoriesHandler,
});

export const previewVoice = action({
  args: previewVoiceArgs,
  handler: previewVoiceHandler,
});

export const fetchAndStoreGenerationUsage = internalAction({
  args: {
    messageId: v.id("messages"),
    chatId: v.id("chats"),
    userId: v.string(),
    openrouterGenerationId: v.string(),
  },
  handler: fetchAndStoreGenerationUsageHandler,
});

export const captureCancelledAssistantResponse = internalAction({
  args: {
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    jobId: v.id("generationJobs"),
    modelId: v.string(),
    source: v.union(
      v.literal("chat_generation"),
      v.literal("web_search"),
      v.literal("research_paper"),
      v.literal("subagent_parent_resume"),
      v.literal("scheduled_job"),
      v.literal("video_generation"),
    ),
    analytics: v.optional(analyticsClientMetadataValidator),
    subagentBatchId: v.optional(v.id("subagentBatches")),
    drivePickerBatchId: v.optional(v.id("drivePickerBatches")),
    emitStarted: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    const properties = {
      subagent_batch_id: args.subagentBatchId ? String(args.subagentBatchId) : undefined,
      drive_picker_batch_id: args.drivePickerBatchId ? String(args.drivePickerBatchId) : undefined,
    };
    if (args.emitStarted === true) {
      await captureAssistantResponseStartedEvent(_ctx, {
        userId: args.userId,
        chatId: String(args.chatId),
        messageId: String(args.messageId),
        jobId: String(args.jobId),
        modelId: args.modelId,
        source: args.source,
        analytics: args.analytics,
        participantCount: 1,
        properties: {
          ...properties,
          setup_phase: "cancelled_before_start",
        },
      });
    }
    await captureAssistantResponseFailure(_ctx, {
      userId: args.userId,
      chatId: String(args.chatId),
      messageId: String(args.messageId),
      jobId: String(args.jobId),
      modelId: args.modelId,
      source: args.source,
      cancelled: true,
      analytics: args.analytics,
      properties,
    });
  },
});

// ── M29: Video Generation ─────────────────────────────────────────────

export const submitVideoGeneration = internalAction({
  args: submitVideoGenerationArgs,
  handler: submitVideoGenerationHandler,
});

export const pollVideoGeneration = internalAction({
  args: pollVideoGenerationArgs,
  handler: pollVideoGenerationHandler,
});
