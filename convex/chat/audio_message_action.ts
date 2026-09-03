"use node";

import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  captureBackendAIOperationCompleted,
  captureBackendAIOperationFailed,
  captureBackendAIOperationStarted,
} from "../analytics/backend_events";
import { MODEL_IDS } from "../lib/model_constants";
import { getOptionalUserOpenRouterApiKey } from "../lib/user_secrets";
import { recordMediaGenerationUsage } from "../tools/media_generation_usage";
import {
  clearAudioGeneratingRef,
  patchMessageAudioRef,
} from "./audio_refs";
import {
  resolveSpeechConfiguration,
  synthesizeText,
  type ResolvedSpeechOptions,
} from "./audio_speech";
import { DEFAULT_TTS_VOICE } from "./audio_shared";
export interface MessageAudioExecution {
  runId: Id<"executionRuns">;
  attemptId: Id<"executionAttempts">;
  fence: number;
  claimantId: string;
}
type GeneratedAudioResult = {
  audioStorageId: Id<"_storage">;
  audioDurationMs: number;
  audioVoice: string;
  audioTranscript: string;
};
function estimateDurationMs(transcript: string): number {
  const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
  return wordCount === 0 ? 0 : Math.round((wordCount / 2.8) * 1000);
}
async function validateExecution(
  ctx: ActionCtx,
  execution: MessageAudioExecution,
): Promise<void> {
  await ctx.runMutation(internal.execution.mutations.validateFence, {
    attemptId: execution.attemptId,
    fence: execution.fence,
  });
}
async function clearGeneratingBestEffort(
  ctx: ActionCtx,
  messageId: Id<"messages">,
  execution: MessageAudioExecution,
): Promise<void> {
  try {
    await ctx.runMutation(clearAudioGeneratingRef, {
      messageId,
      executionRunId: execution.runId,
      executionAttemptId: execution.attemptId,
      executionFence: execution.fence,
    });
  } catch {
    // Cancellation and deletion close the fence and clear the flag in teardown.
  }
}
async function deleteStoredAudioBestEffort(
  ctx: ActionCtx,
  storageId: Id<"_storage"> | undefined,
): Promise<void> {
  if (!storageId) return;
  try {
    await ctx.storage.delete(storageId);
  } catch {
    // The blob may already have been removed by deletion cleanup.
  }
}

export async function generateAudioForMessageHandler(
  ctx: ActionCtx,
  args: {
    messageId: Id<"messages">;
    previewText?: string;
    voiceOverride?: string;
    execution?: MessageAudioExecution;
  },
): Promise<GeneratedAudioResult | null> {
  if (!args.execution) {
    await ctx.runMutation(internal.chat.audio_cleanup.clearLegacyAudioGeneration, {
      messageId: args.messageId,
    });
    return null;
  }
  const execution = args.execution;
  await validateExecution(ctx, execution);
  const message = await ctx.runQuery(internal.chat.queries.getMessageInternal, {
    messageId: args.messageId,
  });
  if (!message || message.role !== "assistant") {
    throw new ConvexError({
      code: "INVALID_INPUT" as const,
      message: "Only assistant messages can generate audio.",
    });
  }
  const textToVoice = args.previewText?.trim() || message.content?.trim();
  if (!textToVoice) {
    throw new ConvexError({
      code: "INVALID_INPUT" as const,
      message: "Assistant message has no content to voice.",
    });
  }
  if (message.audioStorageId && !args.previewText && !args.voiceOverride) {
    await clearGeneratingBestEffort(ctx, args.messageId, execution);
    return {
      audioStorageId: message.audioStorageId,
      audioDurationMs: message.audioDurationMs ?? 0,
      audioVoice: message.audioVoice ?? DEFAULT_TTS_VOICE,
      audioTranscript: message.audioTranscript ?? textToVoice,
    };
  }

  const chat = await ctx.runQuery(internal.chat.queries.getChatInternal, {
    chatId: message.chatId,
  });
  const userId = chat?.userId;
  if (!userId) {
    throw new ConvexError({
      code: "NOT_FOUND" as const,
      message: "Chat not found for message.",
    });
  }

  const source = args.previewText ? "message_audio_preview" : "message_audio";
  let generated: Awaited<ReturnType<typeof synthesizeText>> | undefined;
  let audioStorageId: Id<"_storage"> | undefined;
  let modelId: string = MODEL_IDS.speechGeneration;
  let voice: string | undefined;
  let speechOptions: ResolvedSpeechOptions = { responseFormat: "mp3" };
  let requireZdr = false;
  let operationStartedAt: number | undefined;
  let observedGenerationId: string | null = null;
  try {
    const preferences = await ctx.runQuery(
      internal.chat.queries.getUserPreferences,
      { userId },
    );
    modelId = preferences?.defaultSpeechGenerationModelId
      ?? MODEL_IDS.speechGeneration;
    const configuration = await resolveSpeechConfiguration(
      ctx,
      preferences,
      args.voiceOverride,
    );
    voice = configuration.voice;
    speechOptions = configuration.speechOptions;
    requireZdr = configuration.requireZdr;
    operationStartedAt = Date.now();
    await captureBackendAIOperationStarted(ctx, {
      userId,
      operation: "audio_generation",
      source,
      chatId: String(message.chatId),
      messageId: String(args.messageId),
      modelId,
      properties: {
        voice,
        text_length: textToVoice.length,
        preview_text_used: Boolean(args.previewText),
        voice_override_used: Boolean(args.voiceOverride),
        zdr_required: requireZdr,
      },
    });
    const apiKey = await getOptionalUserOpenRouterApiKey(ctx, userId);
    if (!apiKey) {
      throw new ConvexError({
        code: "MISSING_API_KEY" as const,
        message: "No OpenRouter API key available for audio generation.",
      });
    }
    try {
      generated = await synthesizeText(
        apiKey,
        textToVoice,
        modelId,
        voice,
        speechOptions,
        requireZdr,
        {
          isCancelled: async () => await ctx.runQuery(
            internal.execution.queries.isCancellationRequested,
            {
              attemptId: execution.attemptId,
              fence: execution.fence,
            },
          ),
          onGenerationId: (value) => { observedGenerationId = value; },
        },
      );
      observedGenerationId = generated.generationId ?? observedGenerationId;
    } finally {
      await recordMediaGenerationUsage(ctx, {
        messageId: args.messageId,
        chatId: message.chatId,
        userId,
        modelId,
        source: args.previewText
          ? "media_message_speech_preview"
          : "media_message_speech",
        idempotencyKey: `${String(args.messageId)}:speech:${String(execution.attemptId)}`,
      }, null, observedGenerationId);
    }
    await validateExecution(ctx, execution);
    audioStorageId = await ctx.storage.store(
      new Blob(
        [new Uint8Array(generated.audioBytes)],
        { type: generated.mimeType },
      ),
    );
    await validateExecution(ctx, execution);
  } catch (error) {
    await deleteStoredAudioBestEffort(ctx, audioStorageId);
    await captureBackendAIOperationFailed(ctx, {
      userId,
      operation: "audio_generation",
      source,
      chatId: String(message.chatId),
      messageId: String(args.messageId),
      modelId,
      durationMs: operationStartedAt ? Date.now() - operationStartedAt : undefined,
      error,
      properties: {
        text_length: textToVoice.length,
        preview_text_used: Boolean(args.previewText),
        voice_override_used: Boolean(args.voiceOverride),
        zdr_required: requireZdr,
      },
    });
    await clearGeneratingBestEffort(ctx, args.messageId, execution);
    throw error;
  }

  if (!generated || !audioStorageId || !voice) {
    throw new Error("AUDIO_GENERATION_RESULT_MISSING");
  }
  const audioDurationMs = generated.durationMs
    || estimateDurationMs(generated.transcript);
  const publicationArgs = {
    messageId: args.messageId,
    audioStorageId,
    audioMimeType: generated.mimeType,
    audioDurationMs,
    audioVoice: voice,
    audioTranscript: generated.transcript,
    audioGeneratedAt: Date.now(),
    executionRunId: execution.runId,
    executionAttemptId: execution.attemptId,
    executionFence: execution.fence,
  };
  try {
    await ctx.runMutation(patchMessageAudioRef, publicationArgs);
  } catch {
    try {
      await ctx.runMutation(patchMessageAudioRef, publicationArgs);
    } catch (error) {
      await ctx.runMutation(
        internal.tools.media_generation_mutations.deleteUnreferencedMediaStorage,
        { storageIds: [audioStorageId] },
      ).catch(() => undefined);
      await captureBackendAIOperationFailed(ctx, {
        userId,
        operation: "audio_generation",
        source,
        chatId: String(message.chatId),
        messageId: String(args.messageId),
        modelId,
        durationMs: operationStartedAt ? Date.now() - operationStartedAt : undefined,
        error,
        properties: {
          voice,
          text_length: textToVoice.length,
          transcript_length: generated.transcript.length,
          audio_duration_ms: audioDurationMs,
          audio_byte_count: generated.audioByteCount,
          storage_persisted: false,
          preview_text_used: Boolean(args.previewText),
          voice_override_used: Boolean(args.voiceOverride),
          zdr_required: requireZdr,
        },
      });
      await clearGeneratingBestEffort(ctx, args.messageId, execution);
      throw error;
    }
  }

  await captureBackendAIOperationCompleted(ctx, {
    userId,
    operation: "audio_generation",
    source,
    chatId: String(message.chatId),
    messageId: String(args.messageId),
    modelId,
    durationMs: operationStartedAt ? Date.now() - operationStartedAt : undefined,
    openrouterGenerationId: generated.generationId,
    properties: {
      voice,
      text_length: textToVoice.length,
      transcript_length: generated.transcript.length,
      audio_duration_ms: audioDurationMs,
      audio_byte_count: generated.audioByteCount,
      storage_persisted: true,
      preview_text_used: Boolean(args.previewText),
      voice_override_used: Boolean(args.voiceOverride),
    },
  });

  return {
    audioStorageId,
    audioDurationMs,
    audioVoice: voice,
    audioTranscript: generated.transcript,
  };
}
