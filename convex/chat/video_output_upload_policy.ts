export const MAX_VIDEO_OUTPUT_UPLOAD_BYTES = 512 * 1024 * 1024;
export const VIDEO_OUTPUT_UPLOAD_TTL_MS = 30 * 60 * 1000;

export function isAllowedVideoUploadMimeType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  return normalized.startsWith("video/") || normalized === "application/octet-stream";
}
