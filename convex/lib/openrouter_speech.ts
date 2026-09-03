"use node";

import { ConvexError } from "convex/values";
import {
  cancellationWasRequested,
  OpenRouterTransportCancelledError,
  watchForCancellation,
} from "./openrouter_cancellation";
import {
  HTTP_REFERER,
  REQUEST_TIMEOUT_MS,
  X_TITLE,
} from "./openrouter_constants";
import { extractErrorMessage, openRouterErrorDetails } from "./openrouter_error";

const OPENROUTER_SPEECH_API_URL =
  "https://openrouter.ai/api/v1/audio/speech";

export interface OpenRouterSpeechRequest {
  model: string;
  input: string;
  voice: string;
  responseFormat: "mp3" | "pcm";
  speed?: number;
  provider?: {
    options?: {
      openai?: { instructions: string };
      azure?: { style: string; styledegree?: number };
    };
  };
}

export interface OpenRouterSpeechResult {
  audioBase64: string;
  generationId: string | null;
}

export type SpeechVoiceResolution =
  | { voice: string; error?: never }
  | { voice?: never; error: string };

export interface SpeechOptionCapabilities {
  outputFormats?: Array<"mp3" | "pcm">;
  supportsSpeed: boolean;
  speedMin?: number;
  speedMax?: number;
  supportsInstructions: boolean;
  supportsStyle: boolean;
  styleDegreeMin?: number;
  styleDegreeMax?: number;
}

export interface SpeechOptionValues {
  speed?: number;
  outputFormat?: string;
  instructions?: string;
  style?: string;
  styleDegree?: number;
}

export type SpeechOptionsResolution =
  | {
      value: {
        responseFormat: "mp3" | "pcm";
        speed?: number;
        providerOptions?: NonNullable<OpenRouterSpeechRequest["provider"]>["options"];
      };
      error?: never;
    }
  | { value?: never; error: string };

export function assertOpenRouterSpeechPrivacy(requireZdr: boolean): void {
  if (!requireZdr) return;
  throw new ConvexError({
    code: "SPEECH_GENERATION_ZDR_UNAVAILABLE" as const,
    message:
      "Speech generation is unavailable when Zero Data Retention or protected Google routing is required. Choose a text model or turn off the protected mode.",
  });
}

function optionalText(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function speechFormat(value: string | undefined): "mp3" | "pcm" | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized === "mp3" || normalized === "pcm" ? normalized : undefined;
}

/** Resolve the shared TTS option superset against the selected model. */
export function resolveSpeechOptions(args: {
  capabilities: SpeechOptionCapabilities;
  defaults?: SpeechOptionValues;
  overrides?: SpeechOptionValues;
}): SpeechOptionsResolution {
  const defaults = args.defaults ?? {};
  const overrides = args.overrides ?? {};
  const supportedFormats: Array<"mp3" | "pcm"> = args.capabilities.outputFormats?.length
    ? args.capabilities.outputFormats
    : ["mp3", "pcm"];
  const requestedFormat = speechFormat(overrides.outputFormat);
  const defaultFormat = speechFormat(defaults.outputFormat);
  const responseFormat = (
    requestedFormat && supportedFormats.includes(requestedFormat)
      ? requestedFormat
      : defaultFormat && supportedFormats.includes(defaultFormat)
        ? defaultFormat
        : supportedFormats[0]
  ) ?? "mp3";

  // Some models fill optional numeric tool arguments with zero. Zero is not a
  // valid value for either control, so treat it as omitted instead of turning
  // an otherwise valid request into an unsupported-option retry loop.
  const overrideSpeed = overrides.speed === 0 ? undefined : overrides.speed;
  let speed = overrideSpeed ?? defaults.speed;
  if (speed !== undefined && args.capabilities.supportsSpeed) {
    const min = args.capabilities.speedMin ?? 0.25;
    const max = args.capabilities.speedMax ?? 4;
    if (!Number.isFinite(speed) || speed < min || speed > max) {
      if (overrideSpeed !== undefined) {
        return { error: `Speech speed must be between ${min} and ${max} for the selected model.` };
      }
      speed = undefined;
    }
  }

  const instructions = optionalText(
    overrides.instructions ?? defaults.instructions,
  );

  const style = optionalText(overrides.style ?? defaults.style);
  const overrideStyleDegree = overrides.styleDegree === 0
    ? undefined
    : overrides.styleDegree;
  let styleDegree = overrideStyleDegree ?? defaults.styleDegree;
  if (styleDegree !== undefined && args.capabilities.supportsStyle) {
    if (!style) {
      if (overrideStyleDegree !== undefined) {
        return { error: "Speech style intensity requires a style." };
      }
      styleDegree = undefined;
    }
    const min = args.capabilities.styleDegreeMin ?? 0.01;
    const max = args.capabilities.styleDegreeMax ?? 2;
    if (styleDegree !== undefined && (
      !Number.isFinite(styleDegree) || styleDegree < min || styleDegree > max
    )) {
      if (overrideStyleDegree !== undefined) {
        return { error: `Speech style intensity must be between ${min} and ${max}.` };
      }
      styleDegree = undefined;
    }
  }

  const providerOptions = {
    ...(instructions && args.capabilities.supportsInstructions
      ? { openai: { instructions } }
      : {}),
    ...(style && args.capabilities.supportsStyle
      ? { azure: { style, ...(styleDegree === undefined ? {} : { styledegree: styleDegree }) } }
      : {}),
  };

  return {
    value: {
      responseFormat,
      ...(speed !== undefined && args.capabilities.supportsSpeed ? { speed } : {}),
      ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
    },
  };
}

export function resolveSpeechVoice(args: {
  requestedVoice?: string;
  preferredVoice?: string;
  supportedVoices?: string[];
}): SpeechVoiceResolution {
  const requestedVoice = args.requestedVoice?.trim() || undefined;
  const preferredVoice = args.preferredVoice?.trim() || undefined;
  const supportedVoices = args.supportedVoices?.filter(Boolean);

  if (requestedVoice && (
    !supportedVoices?.length || supportedVoices.includes(requestedVoice)
  )) return { voice: requestedVoice };
  // OpenRouter's dedicated speech endpoint requires a voice even when the
  // model catalogue does not enumerate valid IDs. In that case the user or
  // caller must provide the model-specific provider voice ID explicitly.
  if (!supportedVoices?.length) {
    const voice = requestedVoice ?? preferredVoice;
    return voice
      ? { voice }
      : { error: "A provider voice ID is required for the selected speech model." };
  }
  if (preferredVoice && supportedVoices.includes(preferredVoice)) {
    return { voice: preferredVoice };
  }
  return { voice: supportedVoices[0] };
}

export async function callOpenRouterSpeech(
  apiKey: string,
  request: OpenRouterSpeechRequest,
  options: {
    isCancelled?: () => Promise<boolean>;
    absoluteDeadlineAtMs?: number;
    requireZdr?: boolean;
    onGenerationId?: (generationId: string) => void;
  } = {},
): Promise<OpenRouterSpeechResult> {
  assertOpenRouterSpeechPrivacy(options.requireZdr === true);
  if (await cancellationWasRequested(options.isCancelled)) {
    throw new OpenRouterTransportCancelledError();
  }
  const remainingMs = options.absoluteDeadlineAtMs === undefined
    ? REQUEST_TIMEOUT_MS
    : options.absoluteDeadlineAtMs - Date.now();
  if (remainingMs <= 0) {
    throw new ConvexError({
      code: "TIMEOUT" as const,
      message: "Speech generation took too long. Please try again.",
    });
  }

  const controller = new AbortController();
  let abortReason: "cancelled" | "timeout" | undefined;
  const abort = (reason: "cancelled" | "timeout") => {
    if (controller.signal.aborted) return;
    abortReason = reason;
    controller.abort();
  };
  const stopCancellationWatch = watchForCancellation({
    isCancelled: options.isCancelled,
    onCancelled: () => abort("cancelled"),
  });
  const timeout = setTimeout(
    () => abort("timeout"),
    Math.min(REQUEST_TIMEOUT_MS, remainingMs),
  );

  try {
    const response = await fetch(OPENROUTER_SPEECH_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": HTTP_REFERER,
        "X-Title": X_TITLE,
      },
      body: JSON.stringify({
        model: request.model,
        input: request.input,
        voice: request.voice,
        response_format: request.responseFormat,
        ...(request.speed !== undefined ? { speed: request.speed } : {}),
        ...(request.provider ? { provider: request.provider } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new ConvexError(
        openRouterErrorDetails(response.status, extractErrorMessage(body)),
      );
    }
    const generationId = response.headers.get("x-generation-id");
    if (generationId) options.onGenerationId?.(generationId);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) {
      throw new ConvexError({
        code: "INTERNAL_ERROR" as const,
        message: "OpenRouter speech generation returned no audio payload.",
      });
    }
    if (await cancellationWasRequested(options.isCancelled)) {
      throw new OpenRouterTransportCancelledError();
    }
    return {
      audioBase64: bytes.toString("base64"),
      generationId,
    };
  } catch (error) {
    if (abortReason === "cancelled") {
      throw new OpenRouterTransportCancelledError();
    }
    if (error instanceof ConvexError) throw error;
    if ((error as { name?: unknown })?.name === "AbortError") {
      throw new ConvexError({
        code: "TIMEOUT" as const,
        message: "Speech generation took too long. Please try again.",
      });
    }
    throw error;
  } finally {
    stopCancellationWatch();
    clearTimeout(timeout);
  }
}
