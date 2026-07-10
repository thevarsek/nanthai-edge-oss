import type { Id } from "../_generated/dataModel";
import {
  MAX_GENERATED_IMAGE_BASE64_CHARS,
  MAX_GENERATED_IMAGE_BYTES,
} from "../lib/openrouter_image_limits";

export const MAX_INLINE_IMAGE_BYTES = MAX_GENERATED_IMAGE_BYTES;

interface GeneratedImageStorageContext {
  storage: {
    store: (blob: Blob) => Promise<Id<"_storage">>;
    getUrl: (storageId: Id<"_storage">) => Promise<string | null>;
    delete?: (storageId: Id<"_storage">) => Promise<void>;
  };
}

/** Metadata for a generated image that was stored in Convex storage. */
export interface PersistedImageInfo {
  storageId: Id<"_storage">;
  mimeType: string;
  sizeBytes: number;
}

export interface PersistedImagePayload {
  url: string;
  stored: PersistedImageInfo;
}

export function generatedImagePayloadFitsStorage(sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= MAX_INLINE_IMAGE_BYTES;
}

/** Reject an oversized encoded item before allocating its decoded bytes. */
export function generatedImageBase64FitsStorage(base64: string): boolean {
  if (base64.length === 0) return false;
  if (generatedImageEncodedLengthFitsStorage(base64.length)) return true;

  let whitespaceCount = 0;
  for (const character of base64) {
    if (/\s/.test(character)) whitespaceCount += 1;
  }
  return generatedImageEncodedLengthFitsStorage(base64.length, whitespaceCount);
}

export function generatedImageEncodedLengthFitsStorage(
  encodedChars: number,
  whitespaceChars = 0,
): boolean {
  const effectiveLength = encodedChars - whitespaceChars;
  return effectiveLength > 0 &&
    effectiveLength <= MAX_GENERATED_IMAGE_BASE64_CHARS;
}

/** Persist one decoded Images API item without constructing another data URL. */
export async function persistGeneratedImagePayload(
  ctx: GeneratedImageStorageContext,
  payload: { base64: string; mimeType: string },
): Promise<PersistedImagePayload | null> {
  let storageId: Id<"_storage"> | undefined;
  try {
    if (!generatedImageBase64FitsStorage(payload.base64)) return null;
    const bytes = decodeBase64ToBytes(payload.base64);
    if (!generatedImagePayloadFitsStorage(bytes.length)) return null;
    const mimeType = normalizedImageMimeType(payload.mimeType);
    if (mimeType === "image/svg+xml" && !generatedSvgIsSafe(bytes)) return null;
    const blob = new Blob([bytes as BlobPart], { type: mimeType });
    storageId = await ctx.storage.store(blob);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      await deleteStoredImage(ctx, storageId);
      return null;
    }
    return {
      url,
      stored: { storageId, mimeType, sizeBytes: bytes.length },
    };
  } catch {
    if (storageId) await deleteStoredImage(ctx, storageId);
    return null;
  }
}

function generatedSvgIsSafe(bytes: Uint8Array): boolean {
  let markup: string;
  try {
    markup = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  } catch {
    return false;
  }
  if (!/<svg\b/i.test(markup)) return false;
  const deniedPatterns = [
    /<!\s*doctype\b/i,
    /<!\s*entity\b/i,
    /<\?xml-stylesheet\b/i,
    /<\s*(?:script|foreignobject|iframe|object|embed|link|style|image|a|base|meta|html|head|body|form|input|button|select|textarea|animate|animatemotion|animatetransform|set|mpath)\b/i,
    /\son[a-z0-9_-]+\s*=/i,
    /@import\b/i,
  ];
  return !deniedPatterns.some((pattern) => pattern.test(markup)) &&
    referencesAreInternal(markup);
}

function referencesAreInternal(markup: string): boolean {
  const references = markup.matchAll(
    /\s(?:href|xlink:href|src|xml:base)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
  );
  for (const match of references) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!value.startsWith("#")) return false;
  }
  const cssUrls = markup.matchAll(
    /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi,
  );
  for (const match of cssUrls) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!value.startsWith("#")) return false;
  }
  return true;
}

async function deleteStoredImage(
  ctx: GeneratedImageStorageContext,
  storageId: Id<"_storage">,
): Promise<void> {
  try {
    await ctx.storage.delete?.(storageId);
  } catch {
    // Best effort: a failed cleanup must not replace the storage failure.
  }
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const normalized = /\s/.test(base64) ? base64.replace(/\s+/g, "") : base64;
  const runtimeBuffer = (globalThis as {
    Buffer?: { from: (value: string, encoding: string) => Uint8Array };
  }).Buffer;
  if (runtimeBuffer) return runtimeBuffer.from(normalized, "base64");

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function normalizedImageMimeType(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return /^image\/[a-z0-9.+-]+$/.test(trimmed) ? trimmed : "image/png";
}
