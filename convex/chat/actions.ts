// convex/chat/actions.ts
// =============================================================================
// Stable public/internal action registrations for chat generation pipeline.
// Implementation lives in helper modules so this file keeps function IDs stable
// while remaining small and auditable.
// =============================================================================

"use node";

import { action, internalAction } from "../_generated/server";
import { v } from "convex/values";
import {
  extractMemoriesArgs,
  generateAudioForMessageArgs,
  generateTitleArgs,
  postProcessArgs,
  previewVoiceArgs,
  runGenerationArgs,
  runGenerationParticipantArgs,
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
import { fetchAndStoreGenerationUsageHandler } from "./actions_fetch_usage";

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
