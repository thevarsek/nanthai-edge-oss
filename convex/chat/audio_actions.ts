"use node";

import type { ActionCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import {
  captureBackendAIOperationCompleted,
  captureBackendAIOperationFailed,
  captureBackendAIOperationStarted,
} from "../analytics/backend_events";
import { getOptionalUserOpenRouterApiKey } from "../lib/user_secrets";
import {
  resolveSpeechConfiguration,
  synthesizeText,
} from "./audio_speech";

const PREVIEW_TEXT = "This is a preview of your selected voice for NanthAI Edge.";

export async function previewVoiceHandler(
  ctx: ActionCtx,
  args: { voice: string },
): Promise<{ audioBase64: string; transcript: string; mimeType: string }> {
  const { userId } = await requireAuth(ctx);
  const [apiKey, preferences] = await Promise.all([
    getOptionalUserOpenRouterApiKey(ctx, userId),
    ctx.runQuery(internal.chat.queries.getUserPreferences, { userId }),
  ]);
  if (!apiKey) {
    throw new ConvexError({ code: "MISSING_API_KEY" as const, message: "No OpenRouter API key found. Reconnect OpenRouter in Settings." });
  }
  const configuration = await resolveSpeechConfiguration(ctx, preferences, args.voice);
  const { modelId, voice } = configuration;
  const operationStartedAt = Date.now();
  await captureBackendAIOperationStarted(ctx, {
    userId,
    operation: "audio_preview",
    source: "settings_voice_preview",
    modelId,
    properties: {
      voice,
      text_length: PREVIEW_TEXT.length,
      zdr_required: configuration.requireZdr,
    },
  });
  try {
    const generated = await synthesizeText(
      apiKey,
      PREVIEW_TEXT,
      modelId,
      voice,
      configuration.speechOptions,
      configuration.requireZdr,
    );
    await captureBackendAIOperationCompleted(ctx, {
      userId,
      operation: "audio_preview",
      source: "settings_voice_preview",
      modelId,
      durationMs: Date.now() - operationStartedAt,
      openrouterGenerationId: generated.generationId,
      properties: {
        voice,
        text_length: PREVIEW_TEXT.length,
        transcript_length: generated.transcript.length,
        audio_byte_count: generated.audioByteCount,
      },
    });
    return {
      audioBase64: generated.audioBytes.toString("base64"),
      transcript: generated.transcript,
      mimeType: generated.mimeType,
    };
  } catch (error) {
    await captureBackendAIOperationFailed(ctx, {
      userId,
      operation: "audio_preview",
      source: "settings_voice_preview",
      modelId,
      durationMs: Date.now() - operationStartedAt,
      error,
      properties: {
        voice,
        text_length: PREVIEW_TEXT.length,
      },
    });
    throw error;
  }
}
