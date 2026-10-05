import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { RuntimePacketMaterializationError, type RuntimeImageSource } from "./production_packet";
import { RUNTIME_LIMITS } from "./protocol_common";
import { createRuntimeIdentifier } from "./security";
import type { RuntimeAttachmentGrantInput } from "./attachment_fetch_handles";

export async function materializeSourceImages(
  ctx: ActionCtx,
  sourceMessages: Doc<"messages">[],
  expiresAt: number,
  selectedUrls: Set<string>,
  userId: string,
): Promise<{
  packetParts: RuntimeImageSource[];
  grants: RuntimeAttachmentGrantInput[];
}> {
  const packetParts: RuntimeImageSource[] = [];
  const grants: RuntimeAttachmentGrantInput[] = [];
  for (const sourceMessage of sourceMessages) {
    const generatedImages = sourceMessage.imageUrls?.some(url => selectedUrls.has(url))
      ? await ctx.runQuery(makeFunctionReference<"query", {
          userId: string; chatId: Id<"chats">; messageId: Id<"messages">;
        }, Array<{ url: string; storageId: Id<"_storage">; mimeType: string; sizeBytes: number }>>(
          "runtime_host/generated_image_context:listForMessage",
        ), { userId, chatId: sourceMessage.chatId, messageId: sourceMessage._id })
      : [];
    const attachments = [...(sourceMessage.attachments ?? []),
      ...generatedImages.map(image => ({ ...image, type: "image", name: "Generated image" }))];
    for (const attachment of attachments) {
      if (attachment.type !== "image" || !attachment.url || !selectedUrls.has(attachment.url)) continue;
      if (!attachment.storageId) {
        throw new RuntimePacketMaterializationError(
          "RUNTIME_IMAGE_FETCH_UNAVAILABLE",
          "Local Runtime Host images must be stored by NanthAI",
        );
      }
      const blob = await ctx.storage.get(attachment.storageId);
      const mimeType = blob?.type.trim().toLowerCase() ?? "";
      if (
        !blob
        || blob.size <= 0
        || !mimeType.startsWith("image/")
        || attachment.mimeType?.toLowerCase() !== mimeType
        || attachment.sizeBytes !== blob.size
      ) {
        throw new RuntimePacketMaterializationError(
          "RUNTIME_ATTACHMENT_INVALID",
          "Canonical source image storage does not match its message metadata",
        );
      }
      const sha256 = await sha256Blob(blob);
      const handle = createRuntimeIdentifier("rfa");
      const fetch = {
        handle,
        expiresAt,
        byteLength: blob.size,
        maxChunkBytes: RUNTIME_LIMITS.maxChunkBytes,
        sha256,
      };
      packetParts.push({
        sourceUrl: attachment.url,
        name: attachment.name?.trim() || null,
        mimeType,
        altText: null,
        fetch,
      });
      grants.push({
        sourceMessageId: sourceMessage._id,
        handle,
        storageId: attachment.storageId,
        mimeType,
        byteLength: blob.size,
        maxChunkBytes: RUNTIME_LIMITS.maxChunkBytes,
        sha256,
        expiresAt,
      });
    }
  }
  return { packetParts, grants };
}

async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

