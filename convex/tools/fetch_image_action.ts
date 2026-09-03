"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { fetchPublicImageThroughGateway } from "../mcp/gateway_fetch";
import type { ToolResult } from "./registry";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface FetchPublicImageArgs extends Record<string, unknown> {
  url: string;
  userId: string;
  chatId: Id<"chats">;
  messageId: Id<"messages">;
  jobId: Id<"generationJobs">;
  executionAttemptId: Id<"executionAttempts">;
  executionFence: number;
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

export function detectImageMimeType(bytes: Uint8Array): string | null {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(0, 2) === "BM") return "image/bmp";
  if (
    hasPrefix(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    hasPrefix(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  ) return "image/tiff";
  const text = new TextDecoder().decode(bytes.slice(0, 8_192))
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (
    /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)?(?:<!doctype\s+svg[^>]*>\s*)?<svg(?:\s|>)/i
      .test(text)
  ) return "image/svg+xml";
  return null;
}

function filenameForFetchedImage(mimeType: string): string {
  const extension = mimeType === "image/jpeg"
    ? "jpg"
    : mimeType.split("/")[1]?.replace("svg+xml", "svg") || "png";
  return `fetched-image.${extension}`;
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    await response.body?.cancel();
    throw new Error(
      `Image too large: ${Math.round(declaredLength / 1024 / 1024)}MB exceeds 10MB limit`,
    );
  }
  if (!response.body) throw new Error("Image is empty (0 bytes)");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error(
        `Image too large: more than ${MAX_IMAGE_BYTES / 1024 / 1024}MB exceeds 10MB limit`,
      );
    }
    chunks.push(value);
  }
  if (totalBytes === 0) throw new Error("Image is empty (0 bytes)");
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const defaultDeps = { fetchPublicImageThroughGateway };

export async function fetchPublicImageHandler(
  ctx: ActionCtx,
  args: FetchPublicImageArgs,
  deps: typeof defaultDeps = defaultDeps,
): Promise<ToolResult> {
  try {
    const response = await deps.fetchPublicImageThroughGateway(args.url);
    if (!response.ok) {
      const status = [response.status, response.statusText].filter(Boolean).join(" ");
      await response.body?.cancel();
      return {
        success: false,
        data: null,
        error: `Failed to fetch image: HTTP ${status}`,
      };
    }

    const bytes = await readBoundedBody(response);
    const mimeType = detectImageMimeType(bytes);
    if (!mimeType) {
      return {
        success: false,
        data: null,
        error: "Fetched URL did not return a supported image file.",
      };
    }

    const imageBlob = new Blob([Uint8Array.from(bytes).buffer], { type: mimeType });
    const storageId = await ctx.storage.store(imageBlob);
    const publicationArgs = {
      userId: args.userId,
      chatId: args.chatId,
      messageId: args.messageId,
      jobId: args.jobId,
      executionAttemptId: args.executionAttemptId,
      executionFence: args.executionFence,
      storageId,
      filename: filenameForFetchedImage(mimeType),
      mimeType,
      sizeBytes: bytes.byteLength,
    };
    try {
      await ctx.runMutation(
        internal.tools.media_generation_mutations.insertFetchedImageAttachment,
        publicationArgs,
      );
    } catch {
      try {
        await ctx.runMutation(
          internal.tools.media_generation_mutations.insertFetchedImageAttachment,
          publicationArgs,
        );
      } catch (error) {
        await ctx.runMutation(
          internal.tools.media_generation_mutations.deleteUnreferencedMediaStorage,
          { storageIds: [storageId] },
        ).catch(() => undefined);
        throw error;
      }
    }

    const sizeKB = Math.round(bytes.byteLength / 1024);
    return {
      success: true,
      data: {
        imageStorageId: storageId,
        mimeType,
        sizeKB,
        source: "url",
        originalUrl: args.url,
        message:
          `Image fetched and stored (${sizeKB}KB, ${mimeType}). ` +
          `Use imageStorageId "${storageId}" in generate_pptx/edit_pptx image fields.`,
      },
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: `Failed to fetch image: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const fetchPublicImage = internalAction({
  args: {
    url: v.string(),
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    jobId: v.id("generationJobs"),
    executionAttemptId: v.id("executionAttempts"),
    executionFence: v.number(),
  },
  returns: v.any(),
  handler: fetchPublicImageHandler,
});
