import {
  persistGeneratedImagePayload,
  type PersistedImageInfo,
} from "./action_generated_image_storage";
import type { AttachmentStorageContext } from "./action_attachment_hydration";

export {
  hydrateAttachmentsForRequest,
  type MessageWithStoredAttachments,
} from "./action_attachment_hydration";

export {
  generatedImageBase64FitsStorage,
  generatedImageEncodedLengthFitsStorage,
  generatedImagePayloadFitsStorage,
  MAX_INLINE_IMAGE_BYTES,
  persistGeneratedImagePayload,
  type PersistedImageInfo,
  type PersistedImagePayload,
} from "./action_generated_image_storage";

const MAX_STREAMING_CONTENT_CHARS = 300_000;
const INLINE_DATA_IMAGE_REGEX =
  /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi;

type StorageContext = AttachmentStorageContext;

function parseDataUrl(
  value: string,
): { mimeType: string; base64: string } | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("data:")) return null;
  const match = trimmed.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  return {
    mimeType: match[1] || "application/octet-stream",
    base64: match[2] || "",
  };
}

export function clampMessageContent(content: string): string {
  if (content.length <= MAX_STREAMING_CONTENT_CHARS) {
    return content;
  }

  const suffix = "\n\n[Output truncated]";
  return content.slice(0, MAX_STREAMING_CONTENT_CHARS) + suffix;
}

export function extractInlineImagePayloads(
  text: string,
): { text: string; imagePayloads: string[] } {
  if (!text.includes("data:image/")) {
    return { text, imagePayloads: [] };
  }

  const imagePayloads: string[] = [];
  const stripped = text.replace(INLINE_DATA_IMAGE_REGEX, (match) => {
    const compact = match.replace(/\s+/g, "");
    if (compact.length > 0) {
      imagePayloads.push(compact);
    }
    return "";
  });

  const cleanedText = stripped
    .replace(/!\[[^\]]*]\(\s*\)/g, "")
    .replace(/\n{3,}/g, "\n\n");

  return {
    text: cleanedText,
    imagePayloads,
  };
}

export function detectStandaloneBase64Image(text: string): string | undefined {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 8_192) return undefined;
  if (!/^[A-Za-z0-9+/=]+$/.test(compact)) return undefined;

  if (compact.startsWith("iVBORw0KGgo")) {
    return `data:image/png;base64,${compact}`;
  }
  if (compact.startsWith("/9j/")) {
    return `data:image/jpeg;base64,${compact}`;
  }
  if (compact.startsWith("R0lGOD")) {
    return `data:image/gif;base64,${compact}`;
  }
  if (compact.startsWith("UklGR")) {
    return `data:image/webp;base64,${compact}`;
  }
  return undefined;
}

function normalizeImageCandidateForDedupe(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const parsedDataUrl = parseDataUrl(trimmed);
  if (parsedDataUrl) {
    const compact = parsedDataUrl.base64.replace(/\s+/g, "");
    return `data:${parsedDataUrl.mimeType};base64,${compact}`;
  }

  if (isLikelyBase64(trimmed)) {
    const detected = detectStandaloneBase64Image(trimmed);
    if (detected) return detected;
    return `data:image/png;base64,${trimmed.replace(/\s+/g, "")}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return trimmed;
}

export function dedupeImageCandidates(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const normalized = normalizeImageCandidateForDedupe(value);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
}

function isLikelyBase64(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  return compact.length >= 64 && /^[A-Za-z0-9+/=]+$/.test(compact);
}

export async function persistGeneratedImageUrls(
  ctx: StorageContext,
  urls: string[],
): Promise<string[]> {
  const result = await persistGeneratedImageUrlsWithTracking(ctx, urls);
  return result.urls;
}

/**
 * Like `persistGeneratedImageUrls`, but also returns storage metadata for each
 * image that was stored (for inserting `generatedMedia` rows in the KB).
 */
export async function persistGeneratedImageUrlsWithTracking(
  ctx: StorageContext,
  urls: string[],
): Promise<{ urls: string[]; mimeTypes: string[]; stored: PersistedImageInfo[] }> {
  if (urls.length === 0) return { urls: [], mimeTypes: [], stored: [] };

  const persisted: string[] = [];
  const mimeTypes: string[] = [];
  const stored: PersistedImageInfo[] = [];

  for (const url of urls) {
    const trimmed = url.trim();
    if (!trimmed) continue;

    if (/^https?:\/\//i.test(trimmed)) {
      persisted.push(trimmed);
      mimeTypes.push(trimmed.toLowerCase().includes(".svg")
        ? "image/svg+xml"
        : "image/url");
      continue;
    }

    let mimeType = "image/png";
    let base64Payload = trimmed;
    let isInlineBinaryPayload = false;

    const parsedDataUrl = parseDataUrl(trimmed);
    if (parsedDataUrl) {
      mimeType = parsedDataUrl.mimeType || mimeType;
      base64Payload = parsedDataUrl.base64;
      isInlineBinaryPayload = true;
    } else if (!isLikelyBase64(trimmed)) {
      persisted.push(trimmed);
      mimeTypes.push("image/url");
      continue;
    } else {
      isInlineBinaryPayload = true;
    }

    try {
      const image = await persistGeneratedImagePayload(ctx, {
        base64: base64Payload,
        mimeType,
      });
      if (image) {
        persisted.push(image.url);
        mimeTypes.push(image.stored.mimeType);
        stored.push(image.stored);
      }
    } catch {
      if (!isInlineBinaryPayload) {
        persisted.push(trimmed);
        mimeTypes.push("image/url");
      }
    }
  }

  const deduplicatedUrls: string[] = [];
  const deduplicatedMimeTypes: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < persisted.length; index += 1) {
    const url = persisted[index];
    if (seen.has(url)) continue;
    seen.add(url);
    deduplicatedUrls.push(url);
    deduplicatedMimeTypes.push(mimeTypes[index] ?? "image/url");
  }

  return { urls: deduplicatedUrls, mimeTypes: deduplicatedMimeTypes, stored };
}
