export const MAX_VIDEO_OUTPUT_UPLOAD_BYTES = 512 * 1024 * 1024;
export const VIDEO_OUTPUT_UPLOAD_TTL_MS = 30 * 60 * 1000;

export function createVideoOutputUploadToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashVideoOutputUploadToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function isAllowedVideoUploadMimeType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  return normalized.startsWith("video/") || normalized === "application/octet-stream";
}
