import { ConvexError } from "convex/values";
import {
  MP3_MIME_TYPE,
  parseMp3DurationMs,
  pcm16Base64ToWavBuffer,
  STREAMING_TTS_FORMAT,
  TTS_PCM_SAMPLE_RATE_HZ,
  TTS_WAV_MIME_TYPE,
} from "./audio_shared";

export type NormalizedInlineAudioOutput = {
  bytes: Buffer;
  durationMs: number;
  extension: "mp3" | "wav" | "flac" | "ogg";
  mimeType: "audio/mpeg" | "audio/wav" | "audio/flac" | "audio/ogg";
  sizeBytes: number;
};

function hasAsciiPrefix(bytes: Buffer, prefix: string): boolean {
  return bytes.subarray(0, prefix.length).toString("ascii") === prefix;
}

function isMp3(bytes: Buffer): boolean {
  return hasAsciiPrefix(bytes, "ID3")
    || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}

function pcm16DurationMs(byteCount: number): number {
  return Math.round((byteCount / (TTS_PCM_SAMPLE_RATE_HZ * 2)) * 1_000);
}

function wavDurationMs(bytes: Buffer): number {
  if (bytes.length < 44) return 0;
  const byteRate = bytes.readUInt32LE(28);
  return byteRate > 0 ? Math.round(((bytes.length - 44) / byteRate) * 1_000) : 0;
}

/**
 * Normalize model-authored inline audio for storage and native playback.
 * The negotiated streaming format is PCM16, but some providers return a
 * self-describing compressed payload instead. File signatures remain the
 * authority; headerless output is treated as the requested PCM16 stream and
 * wrapped in a WAV container.
 */
export function normalizeInlineAudioOutput(
  audioBase64: string,
  requestedFormat: string = STREAMING_TTS_FORMAT,
): NormalizedInlineAudioOutput {
  const source = Buffer.from(audioBase64, "base64");
  if (isMp3(source)) {
    const parsedDuration = parseMp3DurationMs(source);
    return {
      bytes: source,
      durationMs: parsedDuration > 0
        ? parsedDuration
        : Math.round((source.length * 8 * 1_000) / 128_000),
      extension: "mp3",
      mimeType: MP3_MIME_TYPE,
      sizeBytes: source.length,
    };
  }
  if (hasAsciiPrefix(source, "RIFF")) {
    return {
      bytes: source,
      durationMs: wavDurationMs(source),
      extension: "wav",
      mimeType: TTS_WAV_MIME_TYPE,
      sizeBytes: source.length,
    };
  }
  if (hasAsciiPrefix(source, "fLaC")) {
    return { bytes: source, durationMs: 0, extension: "flac", mimeType: "audio/flac", sizeBytes: source.length };
  }
  if (hasAsciiPrefix(source, "OggS")) {
    return { bytes: source, durationMs: 0, extension: "ogg", mimeType: "audio/ogg", sizeBytes: source.length };
  }
  if (requestedFormat !== STREAMING_TTS_FORMAT) {
    throw new ConvexError({
      code: "INTERNAL_ERROR" as const,
      message: "Audio output used an unsupported container.",
    });
  }
  const wav = pcm16Base64ToWavBuffer(audioBase64);
  return {
    bytes: wav,
    durationMs: pcm16DurationMs(source.length),
    extension: "wav",
    mimeType: TTS_WAV_MIME_TYPE,
    sizeBytes: wav.length,
  };
}
