"use node";

import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { MODEL_IDS } from "../lib/model_constants";
import {
  assertOpenRouterSpeechPrivacy,
  callOpenRouterSpeech,
  resolveSpeechOptions,
  resolveSpeechVoice,
  type SpeechOptionsResolution,
} from "../lib/openrouter_speech";
import { isZdrEnabled } from "../lib/openrouter_zdr";
import { speechConfigFromPreferences } from "../preferences/speech_defaults";
import { normalizeInlineAudioOutput } from "./audio_output_persistence";
import { STREAMING_TTS_FORMAT } from "./audio_shared";

export type ResolvedSpeechOptions = NonNullable<SpeechOptionsResolution["value"]>;

export async function synthesizeText(
  apiKey: string,
  text: string,
  modelId: string,
  voice: string,
  speechOptions: ResolvedSpeechOptions,
  requireZdr = false,
  transportOptions: {
    isCancelled?: () => Promise<boolean>;
    absoluteDeadlineAtMs?: number;
    onGenerationId?: (generationId: string) => void;
  } = {},
): Promise<{
  audioBytes: Buffer;
  transcript: string;
  mimeType: string;
  durationMs: number;
  audioByteCount: number;
  generationId: string | null;
}> {
  const result = await callOpenRouterSpeech(apiKey, {
    model: modelId,
    input: text,
    voice,
    responseFormat: speechOptions.responseFormat,
    ...(speechOptions.speed === undefined ? {} : { speed: speechOptions.speed }),
    ...(speechOptions.providerOptions
      ? { provider: { options: speechOptions.providerOptions } }
      : {}),
  }, {
    requireZdr,
    isCancelled: transportOptions.isCancelled,
    absoluteDeadlineAtMs: transportOptions.absoluteDeadlineAtMs,
    onGenerationId: transportOptions.onGenerationId,
  });
  const audio = normalizeInlineAudioOutput(
    result.audioBase64,
    speechOptions.responseFormat === "pcm" ? STREAMING_TTS_FORMAT : "mp3",
  );

  return {
    audioBytes: audio.bytes,
    transcript: text,
    mimeType: audio.mimeType,
    durationMs: audio.durationMs,
    audioByteCount: audio.sizeBytes,
    generationId: result.generationId,
  };
}

export async function resolveSpeechConfiguration(
  ctx: ActionCtx,
  preferences: {
    defaultSpeechGenerationModelId?: string;
    preferredVoice?: string;
    defaultSpeechSpeed?: number;
    defaultSpeechOutputFormat?: string;
    defaultSpeechInstructions?: string;
    defaultSpeechStyle?: string;
    defaultSpeechStyleDegree?: number;
    zdrEnabled?: boolean;
  } | null,
  requestedVoice?: string,
): Promise<{
  modelId: string;
  voice: string;
  speechOptions: ResolvedSpeechOptions;
  requireZdr: boolean;
}> {
  const modelId = preferences?.defaultSpeechGenerationModelId ?? MODEL_IDS.speechGeneration;
  const capabilities = await ctx.runQuery(internal.chat.queries.getModelCapabilities, {
    modelId,
  });
  if (!capabilities?.hasSpeechGeneration) {
    throw new ConvexError({
      code: "INVALID_INPUT" as const,
      message: `The selected default speech model '${modelId}' is unavailable for text-to-speech.`,
    });
  }
  const requireZdr = isZdrEnabled(preferences);
  assertOpenRouterSpeechPrivacy(requireZdr);
  const voiceResolution = resolveSpeechVoice({
    requestedVoice,
    preferredVoice: preferences?.preferredVoice,
    supportedVoices: capabilities.supportedVoices,
  });
  if ("error" in voiceResolution) {
    throw new ConvexError({
      code: "INVALID_INPUT" as const,
      message: voiceResolution.error,
    });
  }
  const optionsResolution = resolveSpeechOptions({
    capabilities: capabilities.speechCapabilities ?? {
      supportsSpeed: false,
      supportsInstructions: false,
      supportsStyle: false,
    },
    defaults: speechConfigFromPreferences(preferences),
  });
  if ("error" in optionsResolution) {
    throw new ConvexError({
      code: "INVALID_INPUT" as const,
      message: optionsResolution.error,
    });
  }
  return {
    modelId,
    voice: voiceResolution.voice,
    speechOptions: optionsResolution.value,
    requireZdr,
  };
}
