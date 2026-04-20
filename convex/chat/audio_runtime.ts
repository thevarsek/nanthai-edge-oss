export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;

    output += alphabet[(triple >> 18) & 0x3f] ?? "";
    output += alphabet[(triple >> 12) & 0x3f] ?? "";
    output += index + 1 < bytes.length ? alphabet[(triple >> 6) & 0x3f] ?? "" : "=";
    output += index + 2 < bytes.length ? alphabet[triple & 0x3f] ?? "" : "=";
  }

  return output;
}

export function isAudioAttachment(
  attachment: { type?: string; mimeType?: string } | null | undefined,
): boolean {
  if (!attachment) return false;
  return attachment.type === "audio" || attachment.mimeType?.startsWith("audio/") === true;
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
  return bytesToBase64(new Uint8Array(arrayBuffer));
}
