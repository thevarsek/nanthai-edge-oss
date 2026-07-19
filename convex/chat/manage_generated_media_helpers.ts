import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  deleteDocumentForDeletedRecord,
  storageHasContentReferences,
} from "../knowledge_base/delete_helpers";
import { deleteDriveGrantCacheForStorage } from "../lib/file_attachments";
import {
  GENERATED_MEDIA_REFERENCE_TRACKING_VERSION,
  isGeneratedMediaReferenceFullyTracked,
} from "../lib/generated_media_reference_tracking";

export async function deleteGeneratedMediaRecord(
  ctx: MutationCtx,
  media: Doc<"generatedMedia">,
): Promise<void> {
  const mayDeleteStorage = isGeneratedMediaReferenceFullyTracked(media);
  await deleteDocumentForDeletedRecord(ctx, media.userId, {
    storageId: media.storageId,
    generatedMediaId: media._id,
  });
  await ctx.db.delete(media._id);

  // Rows created before reference tracking may have URL-only fork/copy
  // descendants with no generatedMedia row. Retain their blob conservatively.
  if (!mayDeleteStorage) return;
  // Forks and chat copies intentionally share the immutable storage blob while
  // owning separate generatedMedia rows. Delete the blob only after the last
  // content reference disappears.
  if (await storageHasContentReferences(ctx, media.storageId)) return;
  await deleteDriveGrantCacheForStorage(ctx, media.userId, media.storageId);
  try {
    await ctx.storage.delete(media.storageId);
  } catch {
    // Storage blob may already be gone; the database cleanup still succeeds.
  }
}

export async function deleteGeneratedMediaForMessage(
  ctx: MutationCtx,
  messageId: Id<"messages">,
): Promise<void> {
  const mediaRows = await ctx.db
    .query("generatedMedia")
    .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
    .collect();
  for (const media of mediaRows) {
    await deleteGeneratedMediaRecord(ctx, media);
  }
}

export async function deleteGeneratedMediaForChatBatch(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  limit: number,
): Promise<number> {
  const mediaRows = await ctx.db
    .query("generatedMedia")
    .withIndex("by_chatId", (q) => q.eq("chatId", chatId))
    .take(limit);
  for (const media of mediaRows) {
    await deleteGeneratedMediaRecord(ctx, media);
  }
  return mediaRows.length;
}

export async function copyGeneratedMediaForMessages(
  ctx: MutationCtx,
  sourceChatId: Id<"chats">,
  targetChatId: Id<"chats">,
  messageIdMap: Map<string, string>,
): Promise<void> {
  const mediaRows = await ctx.db
    .query("generatedMedia")
    .withIndex("by_chatId", (q) => q.eq("chatId", sourceChatId))
    .collect();

  for (const media of mediaRows) {
    const targetMessageId = messageIdMap.get(media.messageId as string);
    if (!targetMessageId) continue;
    await ctx.db.insert("generatedMedia", {
      userId: media.userId,
      chatId: targetChatId,
      messageId: targetMessageId as Id<"messages">,
      storageId: media.storageId,
      type: media.type,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      width: media.width,
      height: media.height,
      durationSeconds: media.durationSeconds,
      model: media.model,
      prompt: media.prompt,
      referenceTrackingVersion: isGeneratedMediaReferenceFullyTracked(media)
        ? GENERATED_MEDIA_REFERENCE_TRACKING_VERSION
        : undefined,
      createdAt: media.createdAt,
    });
  }
}
