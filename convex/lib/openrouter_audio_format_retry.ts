import type { ChatRequestParameters } from "./openrouter_types";

/**
 * OpenRouter exposes audio-output capability but not a reliable per-model
 * format list. Retry only a pre-stream 400 that explicitly rejects PCM16 as
 * an audio format; unrelated provider failures must remain visible.
 */
export function shouldRetryAudioFormatWithMp3(
  status: number,
  errorText: string,
  errorMessage: string,
  params: ChatRequestParameters,
): boolean {
  if (status !== 400 || params.audio?.format.toLowerCase() !== "pcm16") {
    return false;
  }

  const normalized = `${errorMessage} ${errorText}`.toLowerCase();
  const identifiesAudioFormat =
    normalized.includes("audio.format") ||
    normalized.includes("audio format");
  const rejectsFormat =
    normalized.includes("unsupported") ||
    normalized.includes("does not support") ||
    normalized.includes("not supported") ||
    normalized.includes("invalid");
  return identifiesAudioFormat && rejectsFormat;
}
