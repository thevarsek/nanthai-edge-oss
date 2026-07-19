import { ConvexError } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import {
  assertOpenRouterImagePrivacy,
  callOpenRouterImage,
} from "../lib/openrouter_image";
import type { OpenRouterMessage, OpenRouterUsage } from "../lib/openrouter_types";
import {
  persistGeneratedImagePayload,
  type PersistedImageInfo,
} from "./action_image_helpers";
import type { ParticipantConfig, RunGenerationArgs } from "./actions_run_generation_types";
import { buildImageGenerationRequest } from "./image_generation_request";
import { GenerationCancelledError } from "./generation_helpers";
import {
  resolveImageGenerationOptions,
  type ImageSupportedParameters,
} from "./image_generation_defaults";
import type { ImageGenerationConfig } from "../preferences/image_defaults";
import {
  cancellationWasRequested,
  isOpenRouterTransportCancelledError,
} from "../lib/openrouter_cancellation";

export async function runDedicatedImageGeneration(args: {
  ctx: ActionCtx;
  generation: RunGenerationArgs;
  participant: ParticipantConfig;
  requestMessages: OpenRouterMessage[];
  prompt: string;
  apiKey: string;
  maxInputReferences?: number;
  supportedParameters?: ImageSupportedParameters;
  requireZdr: boolean;
  onProviderDispatch?: () => Promise<void>;
}): Promise<{
  usage: OpenRouterUsage | null;
  generationId: string | null;
  imageCount: number;
  requestedCount: number;
}> {
  const generated = await dispatchDedicatedImageGeneration({
    ctx: args.ctx,
    userId: args.generation.userId,
    chatId: args.generation.chatId,
    messageId: args.participant.messageId,
    jobId: args.participant.jobId,
    modelId: args.participant.modelId,
    requestMessages: args.requestMessages,
    prompt: args.prompt,
    apiKey: args.apiKey,
    maxInputReferences: args.maxInputReferences,
    imageConfig: args.generation.imageConfig,
    supportedParameters: args.supportedParameters,
    requireZdr: args.requireZdr,
    triggerUserMessageId: args.generation.userMessageId,
    onProviderDispatch: args.onProviderDispatch,
  });
  return {
    usage: generated.usage,
    generationId: generated.generationId,
    imageCount: generated.imageUrls.length,
    requestedCount: generated.requestedCount,
  };
}

export async function dispatchDedicatedImageGeneration(args: {
  ctx: ActionCtx;
  userId: string;
  chatId: Id<"chats">;
  messageId: Id<"messages">;
  jobId: Id<"generationJobs">;
  modelId: string;
  requestMessages: OpenRouterMessage[];
  prompt: string;
  apiKey: string;
  maxInputReferences?: number;
  imageConfig?: ImageGenerationConfig;
  supportedParameters?: ImageSupportedParameters;
  requireZdr: boolean;
  triggerUserMessageId?: Id<"messages">;
  onProviderDispatch?: () => Promise<void>;
}): Promise<{
  usage: OpenRouterUsage | null;
  generationId: string | null;
  imageUrls: string[];
  requestedCount: number;
}> {
  assertOpenRouterImagePrivacy(args.requireZdr);
  const options = resolveImageGenerationOptions(
    args.imageConfig,
    args.supportedParameters,
  );
  const request = buildImageGenerationRequest({
    model: args.modelId,
    prompt: args.prompt,
    messages: args.requestMessages,
    maxInputReferences: args.maxInputReferences,
    options,
  });
  const requestedCount = request.n;
  const expectedCount = requestedCount ?? 1;
  const maximumAcceptedCount = requestedCount ?? 10;
  await args.ctx.runMutation(
    internal.chat.image_generation_mutations.setExpectedImageCount,
    {
      userId: args.userId,
      chatId: args.chatId,
      messageId: args.messageId,
      jobId: args.jobId,
      expectedCount,
    },
  );
  const imageUrls: string[] = [];
  const storedImages: PersistedImageInfo[] = [];
  let generated: Awaited<ReturnType<typeof callOpenRouterImage>> | undefined;
  let observedImageCount = 0;
  let responseUsage: OpenRouterUsage | null = null;
  let responseGenerationId: string | null = null;

  const deleteStoredImages = async (): Promise<void> => {
    await Promise.all(storedImages.map(async (image) => {
      try {
        await args.ctx.storage.delete(image.storageId);
      } catch {
        // Best-effort cleanup; the original failure or cancellation wins.
      }
    }));
  };

  try {
    generated = await callOpenRouterImage(args.apiKey, request, {
      onDispatch: args.onProviderDispatch,
      isCancelled: async () => await args.ctx.runQuery(
        internal.chat.queries.isJobCancelled,
        { jobId: args.jobId },
      ),
      onMetadata: (metadata) => {
        responseGenerationId = metadata.generationId ?? responseGenerationId;
        responseUsage = metadata.usage ?? responseUsage;
      },
      onImage: async (payload) => {
        observedImageCount += 1;
        if (imageUrls.length >= maximumAcceptedCount) return;
        const cancelled = await cancellationWasRequested(
          async () => await args.ctx.runQuery(
            internal.chat.queries.isJobCancelled,
            { jobId: args.jobId },
          ),
        );
        if (cancelled) throw new GenerationCancelledError();

        const persisted = await persistGeneratedImagePayload(args.ctx, {
          base64: payload.base64,
          mimeType: payload.mediaType,
        });
        if (!persisted) return;
        imageUrls.push(persisted.url);
        storedImages.push(persisted.stored);
      },
    });
  } catch (error) {
    const cancelled = isOpenRouterTransportCancelledError(error) ||
      error instanceof GenerationCancelledError ||
      await cancellationWasRequested(
        async () => await args.ctx.runQuery(
          internal.chat.queries.isJobCancelled,
          { jobId: args.jobId },
        ),
      );
    if (cancelled) {
      await deleteStoredImages();
      throw new GenerationCancelledError();
    }
    if (imageUrls.length === 0) throw error;
  }

  const cancelled = await cancellationWasRequested(
    async () => await args.ctx.runQuery(
      internal.chat.queries.isJobCancelled,
      { jobId: args.jobId },
    ),
  );
  if (cancelled) {
    await deleteStoredImages();
    throw new GenerationCancelledError();
  }
  if (imageUrls.length === 0) {
    throw new ConvexError({
      code: "INTERNAL_ERROR" as const,
      message: "The generated image could not be saved. Please try again.",
    });
  }
  const realizedRequestedCount = requestedCount ?? Math.max(
    1,
    Math.min(maximumAcceptedCount, generated?.imageCount ?? observedImageCount),
  );
  let publication: { published: boolean; cancelled: boolean };
  try {
    publication = await args.ctx.runMutation(
      internal.chat.image_generation_mutations.publishGeneratedImages,
      {
        userId: args.userId,
        chatId: args.chatId,
        messageId: args.messageId,
        jobId: args.jobId,
        modelId: args.modelId,
        prompt: request.prompt,
        images: storedImages.map((image, index) => ({
          ...image,
          url: imageUrls[index] ?? "",
        })),
        requestedCount: realizedRequestedCount,
        usage: generated?.usage ?? responseUsage ?? undefined,
        triggerUserMessageId: args.triggerUserMessageId,
        openrouterGenerationId:
          generated?.generationId ?? responseGenerationId ?? undefined,
      },
    );
  } catch (error) {
    await deleteStoredImages();
    throw error;
  }
  if (!publication.published) {
    await deleteStoredImages();
    if (publication.cancelled) throw new GenerationCancelledError();
    throw new ConvexError({
      code: "INTERNAL_ERROR" as const,
      message: "The image generation could not be published. Please try again.",
    });
  }

  return {
    usage: generated?.usage ?? responseUsage,
    generationId: generated?.generationId ?? responseGenerationId,
    imageUrls,
    requestedCount: realizedRequestedCount,
  };
}
