import { Doc } from "../_generated/dataModel";

export const DEFAULT_TTS_VOICE = "nova";
export const STREAMING_TTS_FORMAT = "pcm16";
export const TTS_WAV_MIME_TYPE = "audio/wav";
export const TTS_PCM_SAMPLE_RATE_HZ = 24_000;

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
