"use node";

import { internal } from "../_generated/api";
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
import type { ToolExecutionContext, ToolResult } from "./registry";
import { publishGeneratedAudio } from "./audio_generation_publication";
import {
  isMediaToolError,
  optionalModelId,
  requiredPrompt,
  requireMediaToolContext,
} from "./media_generation_context";
import { recordMediaGenerationUsage } from "./media_generation_usage";
import { resolveSpeechReferences } from "./speech_references";

type AudioKind = "music" | "speech";

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function executeAudioGeneration(
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
  const requireZdr = toolCtx.requireZdr === true || defaults.zdrEnabled === true;
  const references = kind === "speech" ? await resolveSpeechReferences(
    toolCtx, context.messageId, prompt, requestedModelId, args.reference_storage_ids, requireZdr,
  ) : undefined;
  const modelId = references?.modelId ?? requestedModelId ?? (
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
  if (requireZdr) {
    if (kind === "speech") {
      assertOpenRouterSpeechPrivacy(true, capabilities.hasZdrEndpoint === true);
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
    const voiceResolution = references ? { voice: undefined } : resolveSpeechVoice({
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
        ...(references ? { inputReferences: references.inputReferences } : {}),
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
  return await publishGeneratedAudio(toolCtx, context, {
    kind, modelId, prompt, audioBase64, requestedFormat, audioTranscript,
    effectiveVoice, effectiveSpeechOptions, references,
  });
}

