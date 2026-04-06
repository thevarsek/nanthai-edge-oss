// convex/tools/fetch_image.ts
// =============================================================================
// Tool: fetch_image — fetches an image from a URL or Convex storage, stores it
// in Convex file storage, and returns a lightweight reference (storageId).
//
// Supports two sources:
// 1. `url`       — any public HTTP(S) image URL (fetched via fetch())
// 2. `storageId` — a Convex file storage ID (for images already in the chat)
//                  In this case, validates and returns the same ID.
//
// Returns an imageStorageId that can be passed to generate_pptx/edit_pptx
// image fields. The pptx tools resolve the base64 data internally from
// storage — keeping the conversation context small.
// =============================================================================

import { createTool } from "./registry";
import { Id } from "../_generated/dataModel";

/** Maximum image size we'll fetch (10 MB). */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Allowed image MIME types. */
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
]);

/**
 * Guess MIME type from URL extension when Content-Type is missing or generic.
 */
function guessMimeFromUrl(url: string): string | null {
  const extMatch = url.match(/\.(\w+)(?:\?|#|$)/);
  if (!extMatch) return null;
  const ext = extMatch[1].toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    tiff: "image/tiff",
    tif: "image/tiff",
  };
  return map[ext] ?? null;
}

export const fetchImage = createTool({
  name: "fetch_image",
  description:
    "Fetch an image from a URL or verify an existing storage attachment, and " +
    "return an imageStorageId for embedding in documents or presentations. " +
    "Accepts either a public image URL or a Convex storageId (for images the " +
    "user has attached to the chat). Returns an imageStorageId that should be " +
    "passed to generate_pptx or edit_pptx in the images array. " +
    "Use this only when an image asset is actually needed by another tool workflow. " +
    "Do not use it for ordinary search, text-only research, or document creation unless an image is required. " +
    "IMPORTANT: You do NOT need to pass base64 data — just pass the " +
    "imageStorageId and the pptx tools will resolve the image internally.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "Public HTTP(S) URL of the image to fetch. " +
          "Provide either 'url' or 'storageId', not both.",
      },
      storageId: {
        type: "string",
        description:
          "Convex file storage ID for an image already in the chat. " +
          "Provide either 'url' or 'storageId', not both.",
      },
    },
    required: [],
  },

  execute: async (toolCtx, args) => {
    const url = args.url as string | undefined;
    const storageId = args.storageId as string | undefined;

    if (!url && !storageId) {
      return {
        success: false,
        data: null,
        error: "Provide either 'url' or 'storageId'",
      };
    }
    if (url && storageId) {
      return {
        success: false,
        data: null,
        error: "Provide either 'url' or 'storageId', not both",
      };
    }

    try {
      if (storageId) {
        // ── Validate existing storage ID ──
        const blob = await toolCtx.ctx.storage.get(
          storageId as Id<"_storage">,
        );
        if (!blob) {
          return {
            success: false,
            data: null,
            error: `File not found in storage: ${storageId}`,
          };
        }

        const sizeKB = Math.round(blob.size / 1024);
        const mimeType = blob.type || "image/png";

        return {
          success: true,
          data: {
            imageStorageId: storageId,
            mimeType,
            sizeKB,
            source: "storage",
            message:
              `Image validated (${sizeKB}KB, ${mimeType}). ` +
              `Use imageStorageId "${storageId}" in generate_pptx/edit_pptx image fields.`,
          },
        };
      }

      // ── Fetch from URL and store in Convex ──
      const targetUrl = url!;

      if (
        !targetUrl.startsWith("http://") &&
        !targetUrl.startsWith("https://")
      ) {
        return {
          success: false,
          data: null,
          error: "URL must start with http:// or https://",
        };
      }

      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "NanthAI/1.0 (Image Fetcher)",
          Accept: "image/*",
        },
      });

      if (!response.ok) {
        return {
          success: false,
          data: null,
          error: `Failed to fetch image: HTTP ${response.status} ${response.statusText}`,
        };
      }

      // Check content length if available
      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_IMAGE_BYTES) {
        return {
          success: false,
          data: null,
          error: `Image too large: ${Math.round(parseInt(contentLength) / 1024 / 1024)}MB exceeds 10MB limit`,
        };
      }

      const imageBuffer = await response.arrayBuffer();

      if (imageBuffer.byteLength > MAX_IMAGE_BYTES) {
        return {
          success: false,
          data: null,
          error: `Image too large: ${Math.round(imageBuffer.byteLength / 1024 / 1024)}MB exceeds 10MB limit`,
        };
      }

      if (imageBuffer.byteLength === 0) {
        return {
          success: false,
          data: null,
          error: "Image is empty (0 bytes)",
        };
      }

      // Determine MIME type
      let mimeType: string;
      const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
      if (contentType && ALLOWED_MIME_TYPES.has(contentType)) {
        mimeType = contentType;
      } else {
        const guessed = guessMimeFromUrl(targetUrl);
        if (guessed) {
          mimeType = guessed;
        } else if (contentType && contentType.startsWith("image/")) {
          mimeType = contentType;
        } else {
          mimeType = "image/png";
        }
      }

      // Store in Convex file storage
      const imageBlob = new Blob([imageBuffer], { type: mimeType });
      const newStorageId = await toolCtx.ctx.storage.store(imageBlob);
      const sizeKB = Math.round(imageBuffer.byteLength / 1024);

      return {
        success: true,
        data: {
          imageStorageId: newStorageId,
          mimeType,
          sizeKB,
          source: "url",
          originalUrl: targetUrl,
          message:
            `Image fetched and stored (${sizeKB}KB, ${mimeType}). ` +
            `Use imageStorageId "${newStorageId}" in generate_pptx/edit_pptx image fields.`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to fetch image: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
