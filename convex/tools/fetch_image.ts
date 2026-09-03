// convex/tools/fetch_image.ts
// =============================================================================
// Tool: fetch_image — fetches an image from a URL or Convex storage, stores it
// in Convex file storage, and returns a lightweight reference (storageId).
//
// Supports two sources:
// 1. `url`       — any public HTTP(S) image URL (through pinned outbound egress)
// 2. `storageId` — a Convex file storage ID (for images already in the chat)
//                  In this case, validates and returns the same ID.
//
// Returns an imageStorageId that can be passed to generate_pptx/edit_pptx
// image fields. The pptx tools resolve the base64 data internally from
// storage — keeping the conversation context small.
// =============================================================================

import { makeFunctionReference, type FunctionReference } from "convex/server";
import { createTool, type ToolResult } from "./registry";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  isMediaToolError,
  requireMediaToolContext,
} from "./media_generation_context";

type FetchPublicImageArgs = {
  url: string;
  userId: string;
  chatId: Id<"chats">;
  messageId: Id<"messages">;
  jobId: Id<"generationJobs">;
  executionAttemptId: Id<"executionAttempts">;
  executionFence: number;
};

const fetchPublicImageRef = makeFunctionReference<
  "action",
  FetchPublicImageArgs,
  ToolResult
>("tools/fetch_image_action:fetchPublicImage") as unknown as FunctionReference<
  "action",
  "internal",
  FetchPublicImageArgs,
  ToolResult
>;

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
    const url = typeof args.url === "string" && args.url.trim()
      ? args.url.trim()
      : undefined;
    const storageId = typeof args.storageId === "string" && args.storageId.trim()
      ? args.storageId.trim()
      : undefined;

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
    const context = requireMediaToolContext(toolCtx);
    if (isMediaToolError(context)) return context;

    try {
      if (storageId) {
        const owned = await toolCtx.ctx.runQuery(
          internal.tools.storage_attachment_queries.resolveOwnedStorageAttachments,
          { userId: toolCtx.userId, storageIds: [storageId as Id<"_storage">] },
        );
        if (!owned.some((item) => item.storageId === storageId)) {
          return {
            success: false,
            data: null,
            error: "Image storage reference was not found or is not owned by the current user.",
          };
        }
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

      let targetUrl: URL;
      try {
        targetUrl = new URL(url!);
      } catch {
        return { success: false, data: null, error: "URL must be a valid HTTP(S) URL" };
      }
      if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
        return { success: false, data: null, error: "URL must start with http:// or https://" };
      }
      return await toolCtx.ctx.runAction(fetchPublicImageRef, {
        url: targetUrl.toString(),
        userId: toolCtx.userId,
        chatId: context.chatId,
        messageId: context.messageId,
        jobId: context.jobId,
        executionAttemptId: context.executionAttemptId,
        executionFence: context.executionFence,
      });
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to fetch image: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
