// convex/tools/image_resolver.ts
// =============================================================================
// Shared helper: resolves image references to base64 data URIs for embedding
// in generated documents (pptx, docx, etc.).
//
// Images can be referenced by:
// 1. `imageStorageId` — a Convex storage ID (from fetch_image tool)
// 2. `data` — raw base64 data URI (legacy/direct, still supported)
//
// The resolver fetches from Convex storage and converts to the base64 format
// expected by pptxgenjs: "image/png;base64,iVBOR..."
// =============================================================================

import { ActionCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

export interface ImageInput {
  /** Convex storage ID from fetch_image tool (preferred) */
  imageStorageId?: string;
  /** Raw base64 data URI (legacy fallback) */
  data?: string;
  /** Alt text for accessibility */
  altText?: string;
}

export interface ResolvedImage {
  /** base64 data URI ready for pptxgenjs: "image/png;base64,..." */
  data: string;
  altText: string;
}

/**
 * Convert an ArrayBuffer to a base64 string.
 * Works in Convex V8 runtime (no Node Buffer required).
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Resolve a single image input to a base64 data URI.
 *
 * Priority:
 * 1. If `imageStorageId` is provided, fetch from Convex storage
 * 2. If `data` is provided, use as-is (legacy path)
 * 3. If neither, throw
 */
export async function resolveImage(
  ctx: ActionCtx,
  input: ImageInput,
  index: number,
): Promise<ResolvedImage> {
  const altText = input.altText ?? `Image ${index + 1}`;

  if (input.imageStorageId) {
    const blob = await ctx.storage.get(
      input.imageStorageId as Id<"_storage">,
    );
    if (!blob) {
      throw new Error(`Image not found in storage: ${input.imageStorageId}`);
    }

    const buffer = await blob.arrayBuffer();
    if (buffer.byteLength === 0) {
      throw new Error(`Image is empty (0 bytes): ${input.imageStorageId}`);
    }

    const mimeType = blob.type || "image/png";
    const base64 = arrayBufferToBase64(buffer);
    return {
      data: `${mimeType};base64,${base64}`,
      altText,
    };
  }

  if (input.data) {
    // Legacy: raw base64 data URI passed directly
    return { data: input.data, altText };
  }

  throw new Error(
    `Image ${index + 1}: provide either 'imageStorageId' (from fetch_image) or 'data' (base64)`,
  );
}

/**
 * Resolve all images for a slide, skipping failures with warnings.
 * Returns resolved images and any warning messages.
 */
export async function resolveSlideImages(
  ctx: ActionCtx,
  images: ImageInput[] | undefined,
): Promise<{ resolved: ResolvedImage[]; warnings: string[] }> {
  if (!images || images.length === 0) {
    return { resolved: [], warnings: [] };
  }

  const resolved: ResolvedImage[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < images.length; i++) {
    try {
      const img = await resolveImage(ctx, images[i], i);
      resolved.push(img);
    } catch (e) {
      warnings.push(
        `Skipped image ${i + 1}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { resolved, warnings };
}
