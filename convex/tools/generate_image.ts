"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { persistGeneratedImagePayload } from "../chat/action_generated_image_storage";
import { resolveImageGenerationOptions } from "../chat/image_generation_defaults";
import { buildImageGenerationRequest } from "../chat/image_generation_request";
import type { ImageGenerationConfig } from "../preferences/image_defaults";
import {
  assertOpenRouterImagePrivacy,
  callOpenRouterImage,
} from "../lib/openrouter_image";
import {
  cancellationWasRequested,
  isOpenRouterTransportCancelledError,
} from "../lib/openrouter_cancellation";
import { assertModelSupportsZdr } from "../lib/openrouter_zdr";
import type { OpenRouterUsage } from "../lib/openrouter_types";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { createTool, type ToolResult } from "./registry";
import {
  isMediaToolError,
  optionalModelId,
  requiredPrompt,
  requireMediaToolContext,
} from "./media_generation_context";
import { recordMediaGenerationUsage } from "./media_generation_usage";

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export const generateImage = createTool({
  name: "generate_image",
  description:
    "Generate one or more images from a prompt with the user's configured image model and defaults. " +
    "Optionally override supported image parameters. Returns owned storage IDs that can be passed to presentation or email tools.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "A detailed description of the image to create." },
      model_id: { type: "string", description: "Optional explicit OpenRouter image model ID. Omit to use Chat Defaults." },
      count: { type: "number", description: "Optional image count from 1 to 10." },
      aspect_ratio: { type: "string", description: "Optional aspect ratio such as 16:9, 1:1, or 9:16." },
      resolution: { type: "string", description: "Optional model-supported resolution or size." },
      quality: { type: "string", description: "Optional quality: auto, low, medium, or high." },
      background: { type: "string", description: "Optional background: auto, opaque, or transparent." },
      output_format: { type: "string", description: "Optional output format: auto, png, jpeg, webp, or svg." },
      output_compression: { type: "number", description: "Optional output compression from 0 to 100." },
    },
    required: ["prompt"],
  },
  execute: async (toolCtx, args) => {
    const context = requireMediaToolContext(toolCtx);
    if (isMediaToolError(context)) return context;
    if (!toolCtx.operationIdempotencyKey) {
      return { success: false, data: null, error: "Image generation requires an operation key." };
    }
    const prompt = requiredPrompt(args.prompt);
    if (!prompt) {
      return { success: false, data: null, error: "'prompt' must be between 1 and 50,000 characters." };
    }
    const defaults = await toolCtx.ctx.runQuery(
      internal.preferences.queries.getMediaGenerationDefaults,
      { userId: toolCtx.userId },
    );
    const modelId = optionalModelId(args.model_id) ?? defaults.imageModelId;
    const capabilities = await toolCtx.ctx.runQuery(
      internal.chat.queries.getModelCapabilities,
      { modelId },
    );
    if (!capabilities?.hasImageGeneration) {
      return { success: false, data: null, error: `Model '${modelId}' is unavailable for image generation.` };
    }
    const requireZdr = toolCtx.requireZdr === true || defaults.zdrEnabled === true;
    if (requireZdr) {
      assertModelSupportsZdr({
        modelId,
        capabilities,
        feature: "Image generation",
      });
    }
    assertOpenRouterImagePrivacy(requireZdr);
    const config: ImageGenerationConfig = {
      ...defaults.imageConfig,
      count: optionalNumber(args.count) ?? defaults.imageConfig.count,
      aspectRatio: optionalString(args.aspect_ratio) ?? defaults.imageConfig.aspectRatio,
      resolution: optionalString(args.resolution) ?? defaults.imageConfig.resolution,
      quality: optionalString(args.quality) ?? defaults.imageConfig.quality,
      background: optionalString(args.background) ?? defaults.imageConfig.background,
      outputFormat: optionalString(args.output_format) ?? defaults.imageConfig.outputFormat,
      outputCompression: optionalNumber(args.output_compression) ?? defaults.imageConfig.outputCompression,
    };
    const options = resolveImageGenerationOptions(
      config,
      capabilities.imageCapabilities?.supportedParameters,
    );
    const request = buildImageGenerationRequest({
      model: modelId,
      prompt,
      messages: toolCtx.imageContextMessages ?? [],
      maxInputReferences: capabilities.imageCapabilities?.maxInputReferences,
      options,
    });
    const apiKey = await getRequiredUserOpenRouterApiKey(toolCtx.ctx, toolCtx.userId);
    const stored: Array<{
      storageId: Id<"_storage">;
      url: string;
      mimeType: string;
      sizeBytes: number;
    }> = [];
    let observedUsage: OpenRouterUsage | null = null;
    let observedGenerationId: string | null = null;
    const usageScope = {
      messageId: context.messageId,
      chatId: context.chatId,
      userId: toolCtx.userId,
      modelId,
      source: "media_tool_image",
      idempotencyKey: `${context.jobId}:${context.toolCallId}:usage`,
    };
    const deleteStored = async (): Promise<void> => {
      await Promise.all(stored.map(async (image) => {
        await toolCtx.ctx.storage.delete(image.storageId).catch(() => undefined);
      }));
    };
    let generated: Awaited<ReturnType<typeof callOpenRouterImage>> | undefined;
    try {
      try {
        generated = await callOpenRouterImage(apiKey, request, {
          absoluteDeadlineAtMs: toolCtx.providerDeadlineAtMs,
          isCancelled: async () => await toolCtx.ctx.runQuery(
            internal.chat.queries.isJobCancelled,
            { jobId: context.jobId },
          ),
          onMetadata: (metadata) => {
            observedUsage = metadata.usage ?? observedUsage;
            observedGenerationId = metadata.generationId ?? observedGenerationId;
          },
          onImage: async (payload) => {
            const image = await persistGeneratedImagePayload(toolCtx.ctx, {
              base64: payload.base64,
              mimeType: payload.mediaType,
            });
            if (image) stored.push({ ...image.stored, url: image.url });
          },
        });
      } finally {
        await recordMediaGenerationUsage(
          toolCtx.ctx,
          usageScope,
          generated?.usage ?? observedUsage,
          generated?.generationId ?? observedGenerationId,
        );
      }
    } catch (error) {
      const cancelled = isOpenRouterTransportCancelledError(error) ||
        await cancellationWasRequested(
          async () => await toolCtx.ctx.runQuery(
            internal.chat.queries.isJobCancelled,
            { jobId: context.jobId },
          ),
        );
      if (cancelled || stored.length === 0) {
        await deleteStored();
        throw error;
      }
    }
    if (stored.length === 0) throw new Error("Generated images could not be stored.");
    const result: ToolResult = {
      success: true,
      data: {
        kind: "image",
        modelId,
        prompt,
        requestedCount: options.n ?? 1,
        generatedCount: stored.length,
        images: stored,
        imageUrls: stored.map((image) => image.url),
        imageMimeTypes: stored.map((image) => image.mimeType),
      },
    };
    const publicationArgs = {
      userId: toolCtx.userId,
      chatId: context.chatId,
      messageId: context.messageId,
      jobId: context.jobId,
      executionAttemptId: context.executionAttemptId,
      executionFence: context.executionFence,
      operationKey: toolCtx.operationIdempotencyKey,
      operationResultJson: JSON.stringify(result),
      media: stored.map((image) => ({
        storageId: image.storageId,
        type: "image" as const,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        model: modelId,
        prompt,
      })),
    };
    try {
      await toolCtx.ctx.runMutation(
        internal.tools.media_generation_mutations.insertGeneratedMediaBatch,
        publicationArgs,
      );
    } catch {
      try {
        await toolCtx.ctx.runMutation(
          internal.tools.media_generation_mutations.insertGeneratedMediaBatch,
          publicationArgs,
        );
      } catch (error) {
        await toolCtx.ctx.runMutation(
          internal.tools.media_generation_mutations.deleteUnreferencedMediaStorage,
          { storageIds: stored.map((image) => image.storageId) },
        ).catch(() => undefined);
        throw error;
      }
    }
    return result;
  },
});
