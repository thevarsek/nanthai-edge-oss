"use node";

import { internal } from "../_generated/api";
import { normalizeInlineAudioOutput } from "../chat/audio_output_persistence";
import { STREAMING_TTS_FORMAT } from "../chat/audio_shared";
import { callOpenRouterStreaming } from "../lib/openrouter_stream";
import {
  assertOpenRouterSpeechPrivacy,
  callOpenRouterSpeech,
  resolveSpeechOptions,
  resolveSpeechVoice,
} from "../lib/openrouter_speech";
import { assertModelSupportsZdr, withZdrProvider } from "../lib/openrouter_zdr";
import type { OpenRouterUsage } from "../lib/openrouter_types";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { createTool, type ToolExecutionContext, type ToolResult } from "./registry";
import {
  isMediaToolError,
  optionalModelId,
  requiredPrompt,
  requireMediaToolContext,
} from "./media_generation_context";
import { recordMediaGenerationUsage } from "./media_generation_usage";

type AudioKind = "music" | "speech";

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function filenameStem(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "audio";
}

async function executeAudioGeneration(
  kind: AudioKind,
  toolCtx: ToolExecutionContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const context = requireMediaToolContext(toolCtx);
  if (isMediaToolError(context)) return context;
  if (!toolCtx.operationIdempotencyKey) {
    return { success: false, data: null, error: "Audio generation requires an operation key." };
  }
  const prompt = requiredPrompt(kind === "speech" ? args.text : args.prompt);
  if (!prompt) {
    const field = kind === "speech" ? "text" : "prompt";
    return { success: false, data: null, error: `'${field}' must be between 1 and 50,000 characters.` };
  }
  const defaults = await toolCtx.ctx.runQuery(
    internal.preferences.queries.getMediaGenerationDefaults,
    { userId: toolCtx.userId },
  );
  const requestedModelId = optionalModelId(args.model_id);
  const modelId = requestedModelId ?? (
    kind === "music" ? defaults.musicModelId : defaults.speechModelId
  );
  const capabilities = await toolCtx.ctx.runQuery(
    internal.chat.queries.getModelCapabilities,
    { modelId },
  );
  const supported = kind === "music"
    ? capabilities?.hasMusicGeneration
    : capabilities?.hasSpeechGeneration;
  if (!capabilities || !supported) {
    return { success: false, data: null, error: `Model '${modelId}' is unavailable for ${kind} generation.` };
  }
  const requireZdr = toolCtx.requireZdr === true || defaults.zdrEnabled === true;
  if (requireZdr) {
    if (kind === "speech") {
      assertOpenRouterSpeechPrivacy(true);
    } else {
      assertModelSupportsZdr({
        modelId,
        capabilities,
        feature: "Music generation",
      });
    }
  }
  const apiKey = await getRequiredUserOpenRouterApiKey(toolCtx.ctx, toolCtx.userId);
  let audioBase64: string;
  let audioTranscript = "";
  let generationId: string | null = null;
  let usage: OpenRouterUsage | null = null;
  let requestedFormat: string;
  let effectiveVoice: string | undefined;
  let effectiveSpeechOptions: Record<string, unknown> | undefined;
  const usageScope = {
    messageId: context.messageId,
    chatId: context.chatId,
    userId: toolCtx.userId,
    modelId,
    source: `media_tool_${kind}`,
    idempotencyKey: `${context.jobId}:${context.toolCallId}:usage`,
  };

  if (kind === "speech") {
    const voiceResolution = resolveSpeechVoice({
      requestedVoice: typeof args.voice === "string" ? args.voice : undefined,
      preferredVoice: requestedModelId ? undefined : defaults.speechConfig.voice,
      supportedVoices: capabilities.supportedVoices,
    });
    if ("error" in voiceResolution) {
      return {
        success: false,
        data: { supportedVoices: capabilities.supportedVoices ?? [] },
        error: voiceResolution.error,
      };
    }
    const voice = voiceResolution.voice;
    const optionsResolution = resolveSpeechOptions({
      capabilities: capabilities.speechCapabilities ?? {
        supportsSpeed: false,
        supportsInstructions: false,
        supportsStyle: false,
      },
      defaults: defaults.speechConfig,
      overrides: {
        speed: optionalNumber(args.speed),
        outputFormat: optionalString(args.output_format),
        instructions: optionalString(args.instructions),
        style: optionalString(args.style),
        styleDegree: optionalNumber(args.style_degree),
      },
    });
    if ("error" in optionsResolution) {
      return {
        success: false,
        data: { speechCapabilities: capabilities.speechCapabilities },
        error: optionsResolution.error,
      };
    }
    const speechOptions = optionsResolution.value;
    let result: Awaited<ReturnType<typeof callOpenRouterSpeech>> | undefined;
    try {
      result = await callOpenRouterSpeech(apiKey, {
        model: modelId,
        input: prompt,
        voice,
        responseFormat: speechOptions.responseFormat,
        ...(speechOptions.speed === undefined ? {} : { speed: speechOptions.speed }),
        ...(speechOptions.providerOptions
          ? { provider: { options: speechOptions.providerOptions } }
          : {}),
      }, {
        isCancelled: async () => await toolCtx.ctx.runQuery(
          internal.chat.queries.isJobCancelled,
          { jobId: context.jobId },
        ),
        absoluteDeadlineAtMs: toolCtx.providerDeadlineAtMs,
        requireZdr,
        onGenerationId: (value) => { generationId = value; },
      });
      generationId = result.generationId;
    } finally {
      await recordMediaGenerationUsage(toolCtx.ctx, usageScope, null, generationId);
    }
    audioBase64 = result.audioBase64;
    requestedFormat = speechOptions.responseFormat === "pcm"
      ? STREAMING_TTS_FORMAT
      : "mp3";
    audioTranscript = prompt;
    effectiveVoice = voice;
    effectiveSpeechOptions = {
      outputFormat: speechOptions.responseFormat,
      ...(speechOptions.speed === undefined ? {} : { speed: speechOptions.speed }),
      ...(speechOptions.providerOptions ? { providerOptions: speechOptions.providerOptions } : {}),
    };
  } else {
    requestedFormat = "wav";
    let result: Awaited<ReturnType<typeof callOpenRouterStreaming>> | undefined;
    try {
      result = await callOpenRouterStreaming(
        apiKey,
        modelId,
        [
          {
            role: "system",
            content: "You are a music generation engine. Create the requested music as audio. Do not merely describe it.",
          },
          { role: "user", content: prompt },
        ],
        withZdrProvider({
          modalities: ["text", "audio"],
          audio: { voice: defaults.preferredVoice, format: requestedFormat },
          transforms: null,
        }, requireZdr),
        {
          onGenerationId: async (value) => { generationId = value; },
        },
        {
          absoluteDeadlineAtMs: toolCtx.providerDeadlineAtMs,
          emptyStreamRetries: 0,
          networkRetries: 0,
          isCancelled: async () => await toolCtx.ctx.runQuery(
            internal.chat.queries.isJobCancelled,
            { jobId: context.jobId },
          ),
        },
      );
      generationId = result.generationId ?? generationId;
      usage = result.usage;
    } finally {
      await recordMediaGenerationUsage(toolCtx.ctx, usageScope, usage, generationId);
    }
    if (!result.audioBase64) throw new Error(`${kind} generation returned no audio payload.`);
    audioBase64 = result.audioBase64;
    audioTranscript = result.audioTranscript;
  }
  const audio = normalizeInlineAudioOutput(audioBase64, requestedFormat);
  const storageId = await toolCtx.ctx.storage.store(
    new Blob([new Uint8Array(audio.bytes)], { type: audio.mimeType }),
  );
  let audioUrl: string | null;
  try {
    audioUrl = await toolCtx.ctx.storage.getUrl(storageId);
  } catch (error) {
    await toolCtx.ctx.storage.delete(storageId).catch(() => undefined);
    throw error;
  }
  if (!audioUrl) {
    await toolCtx.ctx.storage.delete(storageId).catch(() => undefined);
    throw new Error("Generated audio could not be retrieved from storage.");
  }
  if (kind === "speech" && !effectiveVoice) {
    await toolCtx.ctx.storage.delete(storageId).catch(() => undefined);
    throw new Error("Speech generation completed without a provider voice ID.");
  }
  const filename = `${filenameStem(kind === "music" ? prompt : "generated-speech")}.${audio.extension}`;
  const operationResultData = {
    kind,
    modelId,
    prompt,
    storageId,
    audioStorageId: storageId,
    audioUrl,
    mimeType: audio.mimeType,
    audioMimeType: audio.mimeType,
    sizeBytes: audio.sizeBytes,
    audioDurationMs: audio.durationMs,
    audioTranscript: kind === "speech" ? (audioTranscript || prompt) : audioTranscript,
    filename,
    toolName: kind === "music" ? "generate_music" : "generate_speech",
    ...(kind === "speech"
      ? {
          voice: effectiveVoice,
          speechOptions: effectiveSpeechOptions,
        }
      : {}),
  };
  const publicationArgs = {
    userId: toolCtx.userId,
    chatId: context.chatId,
    messageId: context.messageId,
    jobId: context.jobId,
    executionAttemptId: context.executionAttemptId,
    executionFence: context.executionFence,
    operationKey: toolCtx.operationIdempotencyKey,
    operationResultDataJson: JSON.stringify(operationResultData),
    storageId,
    filename,
    mimeType: audio.mimeType,
    sizeBytes: audio.sizeBytes,
    toolName: kind === "music"
      ? "generate_music" as const
      : "generate_speech" as const,
  };
  let persisted;
  try {
    persisted = await toolCtx.ctx.runMutation(
      internal.tools.media_generation_mutations.insertGeneratedAudioFile,
      publicationArgs,
    );
  } catch {
    try {
      persisted = await toolCtx.ctx.runMutation(
        internal.tools.media_generation_mutations.insertGeneratedAudioFile,
        publicationArgs,
      );
    } catch (error) {
      await toolCtx.ctx.runMutation(
        internal.tools.media_generation_mutations.deleteUnreferencedMediaStorage,
        { storageIds: [storageId] },
      ).catch(() => undefined);
      throw error;
    }
  }
  return JSON.parse(persisted.resultJson) as ToolResult;
}

export const generateMusic = createTool({
  name: "generate_music",
  description: "Generate original music from a prompt with the user's configured music model. Returns an attached audio file and owned storage ID.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Describe style, mood, instrumentation, structure, vocals, lyrics, and other musical intent." },
      model_id: { type: "string", description: "Optional explicit OpenRouter music model ID. Omit to use Chat Defaults." },
    },
    required: ["prompt"],
  },
  execute: async (toolCtx, args) => await executeAudioGeneration("music", toolCtx, args),
});

export const generateSpeech = createTool({
  name: "generate_speech",
  description: "Generate spoken audio from supplied text with the user's configured speech model and preferred voice. Optional synthesis controls are filtered to the selected model's capabilities. Returns an attached audio file and owned storage ID.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "The exact text to speak." },
      voice: { type: "string", description: "Requested voice. An unavailable voice resolves to a valid configured or model-supported voice." },
      speed: { type: "number", description: "Requested synthesis speed. Applied only when the selected model supports speed control." },
      output_format: { type: "string", enum: ["mp3", "pcm"], description: "Requested audio format. The selected model's supported format is used when this is unavailable." },
      instructions: { type: "string", description: "Speaking direction. Applied only when the selected model supports instructions." },
      style: { type: "string", description: "Expressive speaking style. Applied only when the selected model supports styles." },
      style_degree: { type: "number", description: "Requested style intensity. Applied only when the selected model supports styles." },
      model_id: { type: "string", description: "Explicit OpenRouter speech model override; otherwise Chat Defaults supplies the model." },
    },
    required: ["text"],
  },
  execute: async (toolCtx, args) => await executeAudioGeneration("speech", toolCtx, args),
});
