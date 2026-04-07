import { Doc } from "../_generated/dataModel";

export const DEFAULT_TTS_VOICE = "nova";
export const STREAMING_TTS_FORMAT = "pcm16";
export const TTS_WAV_MIME_TYPE = "audio/wav";
export const TTS_PCM_SAMPLE_RATE_HZ = 24_000;

// ── Lyria (Google Music Generation) ────────────────────────────────────
export const LYRIA_CLIP_MODEL = "google/lyria-3-clip-preview";
export const LYRIA_PRO_MODEL = "google/lyria-3-pro-preview";
export const LYRIA_MP3_MIME_TYPE = "audio/mpeg";

/** Returns true when `modelId` is one of the Lyria music-generation models. */
export function isLyriaModel(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  return modelId === LYRIA_CLIP_MODEL || modelId === LYRIA_PRO_MODEL;
}

/**
 * Parse the duration of an MP3 buffer by walking MPEG sync frames.
 *
 * Returns duration in milliseconds, or 0 if no valid frames are found.
 * Handles ID3v2 tags at the start and skips non-sync data gracefully.
 *
 * Supports MPEG-1 Layer III (the format Lyria returns) as well as
 * MPEG-2 and MPEG-2.5 Layer II/III for robustness.
 */
export function parseMp3DurationMs(buf: Buffer): number {
  const len = buf.length;
  let offset = 0;

  // Skip ID3v2 header if present
  if (len >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    // ID3v2 size is stored as 4 × 7-bit "synchsafe" integers
    const size =
      ((buf[6] & 0x7f) << 21) |
      ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) |
      (buf[9] & 0x7f);
    offset = 10 + size;
  }

  // MPEG version → sample-rate table index
  //   0b11 = MPEG1, 0b10 = MPEG2, 0b00 = MPEG2.5
  const sampleRates: Record<number, number[]> = {
    0b11: [44100, 48000, 32000],
    0b10: [22050, 24000, 16000],
    0b00: [11025, 12000, 8000],
  };

  // Samples-per-frame by [version][layer]
  //   Layer indices: 0b11=I, 0b10=II, 0b01=III
  const samplesPerFrame: Record<number, Record<number, number>> = {
    0b11: { 0b11: 384, 0b10: 1152, 0b01: 1152 },  // MPEG1
    0b10: { 0b11: 384, 0b10: 1152, 0b01: 576 },    // MPEG2
    0b00: { 0b11: 384, 0b10: 1152, 0b01: 576 },    // MPEG2.5
  };

  // Bitrate tables (kbps) indexed by [version-layer key][bitrateIndex]
  // MPEG1 Layer III
  const bitratesMpeg1L3 = [
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
  ];
  // MPEG2/2.5 Layer III
  const bitratesMpeg2L3 = [
    0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
  ];

  let totalDurationMs = 0;
  let framesFound = 0;

  while (offset + 4 <= len) {
    // Look for sync word: 0xFF followed by 0xE0+ (11 sync bits)
    if (buf[offset] !== 0xff || (buf[offset + 1] & 0xe0) !== 0xe0) {
      offset++;
      continue;
    }

    const b1 = buf[offset + 1];
    const b2 = buf[offset + 2];

    const versionBits = (b1 >> 3) & 0x03; // 0b11=V1, 0b10=V2, 0b00=V2.5, 0b01=reserved
    const layerBits = (b1 >> 1) & 0x03;   // 0b11=I, 0b10=II, 0b01=III, 0b00=reserved
    const bitrateIdx = (b2 >> 4) & 0x0f;
    const srIdx = (b2 >> 2) & 0x03;
    const padding = (b2 >> 1) & 0x01;

    // Skip reserved combinations
    if (versionBits === 0b01 || layerBits === 0b00 || bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3) {
      offset++;
      continue;
    }

    const srTable = sampleRates[versionBits];
    const spf = samplesPerFrame[versionBits]?.[layerBits];
    if (!srTable || !spf) {
      offset++;
      continue;
    }
    const sampleRate = srTable[srIdx];

    // Select bitrate table
    const bitrate =
      versionBits === 0b11 && layerBits === 0b01
        ? bitratesMpeg1L3[bitrateIdx]
        : layerBits === 0b01
          ? bitratesMpeg2L3[bitrateIdx]
          : 0; // We only need Layer III for Lyria; skip others

    if (bitrate === 0) {
      offset++;
      continue;
    }

    // Frame size (bytes)
    const frameSize =
      layerBits === 0b11 // Layer I
        ? Math.floor(((12 * bitrate * 1000) / sampleRate + padding) * 4)
        : Math.floor((spf / 8) * ((bitrate * 1000) / sampleRate) + padding);

    if (frameSize < 1) {
      offset++;
      continue;
    }

    totalDurationMs += (spf / sampleRate) * 1000;
    framesFound++;
    offset += frameSize;
  }

  return framesFound > 0 ? Math.round(totalDurationMs) : 0;
}

export function pcm16Base64ToWavBuffer(
  audioBase64: string,
  sampleRateHz: number = TTS_PCM_SAMPLE_RATE_HZ,
): Buffer {
  const pcmBytes = Buffer.from(audioBase64, "base64");
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const byteRate = sampleRateHz * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const wav = Buffer.alloc(44 + pcmBytes.length);

  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + pcmBytes.length, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRateHz, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(pcmBytes.length, 40);
  pcmBytes.copy(wav, 44);

  return wav;
}

export function isAudioAttachment(
  attachment: { type?: string; mimeType?: string } | null | undefined,
): boolean {
  if (!attachment) return false;
  return attachment.type === "audio" || attachment.mimeType?.startsWith("audio/") === true;
}

export function isAudioBasedUserMessage(
  message:
    | (Doc<"messages"> & { attachments?: Array<{ type?: string; mimeType?: string }> })
    | null
    | undefined,
): boolean {
  if (!message || message.role !== "user") return false;
  if (message.audioStorageId) return true;
  return message.attachments?.some((attachment) => isAudioAttachment(attachment)) ?? false;
}

export function resolveAutoAudioResponseEnabled(
  chat:
    | { autoAudioResponseOverride?: "enabled" | "disabled" | undefined }
    | null
    | undefined,
  preferences:
    | { autoAudioResponse?: boolean | undefined }
    | null
    | undefined,
): boolean {
  if (chat?.autoAudioResponseOverride === "enabled") return true;
  if (chat?.autoAudioResponseOverride === "disabled") return false;
  return preferences?.autoAudioResponse === true;
}

export function preferredVoiceFromPreferences(
  preferences:
    | { preferredVoice?: string | undefined }
    | null
    | undefined,
): string {
  const voice = preferences?.preferredVoice?.trim();
  return voice && voice.length > 0 ? voice : DEFAULT_TTS_VOICE;
}

export function guessAudioInputFormat(
  mimeType?: string | null,
  filename?: string | null,
): string {
  const mime = mimeType?.toLowerCase() ?? "";
  if (mime.includes("mpeg") || mime.endsWith("/mp3")) return "mp3";
  if (mime.includes("aac")) return "aac";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("flac")) return "flac";
  if (mime.includes("wav") || mime.includes("wave")) return "wav";
  if (mime.includes("aiff")) return "aiff";
  if (mime.includes("pcm")) return "pcm16";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";

  const ext = filename?.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp3":
    case "aac":
    case "ogg":
    case "flac":
    case "wav":
    case "aiff":
    case "m4a":
      return ext;
    default:
      return "m4a";
  }
}

export async function fetchBinaryAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio payload (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}
