"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { snapToSupportedAspectRatio, snapToSupportedDuration, snapToSupportedResolution } from
  "../chat/actions_video_generation";
import { resolveVideoAudioParameter } from "../chat/video_generation_capabilities";
import { assertModelSupportsZdr } from "../lib/openrouter_zdr";
import { createTool, type ToolResult } from "./registry";
import {
  isMediaToolError,
  optionalModelId,
  requiredPrompt,
  requireMediaToolContext,
} from "./media_generation_context";
import type { ToolVideoConfig } from "./video_generation_contract";

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export const generateVideo = createTool({
  name: "generate_video",
  mayDefer: true,
  description:
    "Generate a video from a prompt with the user's configured video model and defaults. " +
    "The durable result is attached to the conversation and includes an owned storage ID for email drafts.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "A detailed description of the video to create." },
      model_id: { type: "string", description: "Optional explicit OpenRouter video model ID. Omit to use Chat Defaults." },
      aspect_ratio: { type: "string", description: "Optional model-supported aspect ratio such as 16:9 or 9:16." },
      resolution: { type: "string", description: "Optional model-supported resolution such as 720p or 1080p." },
      duration: { type: "number", description: "Optional duration in seconds." },
      generate_audio: { type: "boolean", description: "Optionally request an audio track when supported." },
      seed: { type: "number", description: "Optional integer seed when supported by the selected model." },
    },
    required: ["prompt"],
  },
  execute: async (toolCtx, args) => {
    const context = requireMediaToolContext(toolCtx);
    if (isMediaToolError(context)) return context;
    if (!toolCtx.userMessageId || !toolCtx.operationIdempotencyKey) {
      return {
        success: false,
        data: null,
        error: "Video generation requires an owned user turn and operation key.",
      };
    }
    const prompt = requiredPrompt(args.prompt);
    if (!prompt) {
      return { success: false, data: null, error: "'prompt' must be between 1 and 50,000 characters." };
    }
    const defaults = await toolCtx.ctx.runQuery(
      internal.preferences.queries.getMediaGenerationDefaults,
      { userId: toolCtx.userId },
    );
    const modelId = optionalModelId(args.model_id) ?? defaults.videoModelId;
    const capabilities = await toolCtx.ctx.runQuery(
      internal.chat.queries.getModelCapabilities,
      { modelId },
    );
    if (!capabilities?.hasVideoGeneration) {
      return { success: false, data: null, error: `Model '${modelId}' is unavailable for video generation.` };
    }
    const requireZdr = toolCtx.requireZdr === true || defaults.zdrEnabled === true;
    if (requireZdr) {
      assertModelSupportsZdr({ modelId, capabilities, feature: "Video generation" });
    }
    const videoCapabilities = capabilities.videoCapabilities;
    const requestedDuration = optionalNumber(args.duration) ?? defaults.videoConfig.duration ?? 5;
    const requestedAspectRatio = optionalString(args.aspect_ratio) ?? defaults.videoConfig.aspectRatio ?? "16:9";
    const requestedResolution = optionalString(args.resolution) ?? defaults.videoConfig.resolution;
    const config: ToolVideoConfig = {
      duration: videoCapabilities?.supportedDurations.length
        ? snapToSupportedDuration(requestedDuration, videoCapabilities.supportedDurations)
        : requestedDuration,
      aspectRatio: videoCapabilities?.supportedAspectRatios.length
        ? snapToSupportedAspectRatio(requestedAspectRatio, videoCapabilities.supportedAspectRatios)
        : requestedAspectRatio,
      generateAudio: resolveVideoAudioParameter(
        videoCapabilities?.generateAudio,
        typeof args.generate_audio === "boolean"
          ? args.generate_audio
          : defaults.videoConfig.generateAudio,
      ),
    };
    if (requestedResolution) {
      config.resolution = videoCapabilities?.supportedResolutions.length
        ? snapToSupportedResolution(requestedResolution, videoCapabilities.supportedResolutions)
        : requestedResolution;
    }
    const requestedSeed = optionalNumber(args.seed);
    if (requestedSeed !== undefined && videoCapabilities?.seed) {
      config.seed = Math.trunc(requestedSeed);
    }
    const creationArgs = {
      userId: toolCtx.userId,
      chatId: context.chatId,
      messageId: context.messageId,
      sourceUserMessageId: toolCtx.userMessageId as Id<"messages">,
      generationJobId: context.jobId,
      toolCallId: context.toolCallId,
      toolOperationKey: toolCtx.operationIdempotencyKey,
      model: modelId,
      prompt,
      videoConfig: config,
      requireZdr,
      executionAttemptId: context.executionAttemptId,
      executionFence: context.executionFence,
    };
    let persisted;
    try {
      persisted = await toolCtx.ctx.runMutation(
        internal.tools.video_generation_mutations.createToolVideoJob,
        creationArgs,
      );
    } catch {
      persisted = await toolCtx.ctx.runMutation(
        internal.tools.video_generation_mutations.createToolVideoJob,
        creationArgs,
      );
    }
    return JSON.parse(persisted.resultJson) as ToolResult;
  },
});
