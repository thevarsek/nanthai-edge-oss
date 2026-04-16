import { Id } from "../_generated/dataModel";

const MAX_STREAMING_CONTENT_CHARS = 300_000;
const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;
const INLINE_DATA_IMAGE_REGEX =
  /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi;

interface StoredAttachment {
  type: string;
  url?: string;
  storageId?: Id<"_storage">;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface MessageWithStoredAttachments {
  _id: Id<"messages">;
  role: string;
  content: string;
  attachments?: StoredAttachment[];
  [key: string]: unknown;
}

interface StorageContext {
  storage: {
    store: (blob: Blob) => Promise<Id<"_storage">>;
    get: (storageId: Id<"_storage">) => Promise<Blob | null>;
    getUrl: (storageId: Id<"_storage">) => Promise<string | null>;
  };
}

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

function decodeBase64ToBytes(base64: string): Uint8Array {
  const normalized = base64.replace(/\s+/g, "");
  const runtimeBuffer = (globalThis as {
    Buffer?: { from: (value: string, encoding: string) => Uint8Array };
  }).Buffer;
  if (runtimeBuffer) {
    return new Uint8Array(runtimeBuffer.from(normalized, "base64"));
  }
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  const runtimeBuffer = (globalThis as {
    Buffer?: {
      from: (value: Uint8Array) => { toString: (encoding: string) => string };
    };
  }).Buffer;
  if (runtimeBuffer) {
    return runtimeBuffer.from(bytes).toString("base64");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function persistGeneratedImageUrls(
  ctx: StorageContext,
  urls: string[],
): Promise<string[]> {
  const result = await persistGeneratedImageUrlsWithTracking(ctx, urls);
  return result.urls;
}

/** Metadata for a generated image that was stored in Convex storage. */
export interface PersistedImageInfo {
  storageId: Id<"_storage">;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Like `persistGeneratedImageUrls`, but also returns storage metadata for each
 * image that was stored (for inserting `generatedMedia` rows in the KB).
 */
export async function persistGeneratedImageUrlsWithTracking(
  ctx: StorageContext,
  urls: string[],
): Promise<{ urls: string[]; stored: PersistedImageInfo[] }> {
  if (urls.length === 0) return { urls: [], stored: [] };

  const persisted: string[] = [];
  const stored: PersistedImageInfo[] = [];

  for (const url of urls) {
    const trimmed = url.trim();
    if (!trimmed) continue;

    if (/^https?:\/\//i.test(trimmed)) {
      persisted.push(trimmed);
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
      continue;
    } else {
      isInlineBinaryPayload = true;
    }

    try {
      const bytes = decodeBase64ToBytes(base64Payload);
      if (bytes.length === 0) continue;
      if (bytes.length > MAX_INLINE_IMAGE_BYTES) {
        continue;
      }
      const inlineBytes = bytes.slice();
      const blob = new Blob([inlineBytes], {
        type: mimeType,
      });
      const storageId = await ctx.storage.store(blob);
      const storageUrl = await ctx.storage.getUrl(storageId);
      if (storageUrl) {
        persisted.push(storageUrl);
        stored.push({ storageId, mimeType, sizeBytes: inlineBytes.length });
      }
    } catch {
      if (!isInlineBinaryPayload) {
        persisted.push(trimmed);
      }
    }
  }

  return { urls: Array.from(new Set(persisted)), stored };
}

export async function hydrateAttachmentsForRequest(
  ctx: StorageContext,
  messages: MessageWithStoredAttachments[],
): Promise<MessageWithStoredAttachments[]> {
  const hydrated = await Promise.all(
    messages.map(async (message) => {
      if (!message.attachments || message.attachments.length === 0) {
        return message;
      }

      const attachments = await Promise.all(
        message.attachments.map(async (attachment) => {
          if (!attachment.storageId) {
            return attachment;
          }

          if (attachment.type === "image") {
            const imageUrl = await ctx.storage.getUrl(attachment.storageId);
            if (!imageUrl) return attachment;
            return { ...attachment, url: imageUrl };
          }

          try {
            const stored = await ctx.storage.get(attachment.storageId);
            if (!stored) {
              return attachment;
            }
            const bytes = new Uint8Array(await stored.arrayBuffer());
            const mimeType = attachment.mimeType ?? "application/octet-stream";
            return {
              ...attachment,
              url: `data:${mimeType};base64,${encodeBytesToBase64(bytes)}`,
              sizeBytes: attachment.sizeBytes ?? bytes.length,
            };
          } catch {
            return attachment;
          }
        }),
      );

      return { ...message, attachments };
    }),
  );

  return hydrated;
}
