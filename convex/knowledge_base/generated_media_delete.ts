import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteDriveGrantCacheForStorage } from "../lib/file_attachments";
import { isGeneratedMediaReferenceFullyTracked } from "../lib/generated_media_reference_tracking";
import {
  deleteDocumentForDeletedRecord,
  storageHasContentReferences,
} from "./delete_helpers";

async function removeGeneratedMediaFromMessage(
  ctx: MutationCtx,
  media: Doc<"generatedMedia">,
): Promise<void> {
  const message = await ctx.db.get(media.messageId);
  if (!message) return;
  const storageUrl = await ctx.storage.getUrl(media.storageId);

  if (media.type === "video") {
    const videoUrls = [...(message.videoUrls ?? [])];
    const index = storageUrl ? videoUrls.indexOf(storageUrl) : -1;
    if (index < 0) return;
    videoUrls.splice(index, 1);
    await ctx.db.patch(message._id, { videoUrls });
    return;
  }

  const imageUrls = [...(message.imageUrls ?? [])];
  let index = storageUrl ? imageUrls.indexOf(storageUrl) : -1;
  if (index < 0) {
    // Storage URLs are normally stable, but retain an index-aligned fallback for
    // legacy rows whose stored URL differs from the URL returned today.
    const messageMedia = await ctx.db
      .query("generatedMedia")
      .withIndex("by_messageId", (q) => q.eq("messageId", media.messageId))
      .collect();
    const orderedImages = messageMedia
      .filter((candidate) => candidate.type === "image")
      .sort((left, right) =>
        left.createdAt - right.createdAt || left._creationTime - right._creationTime
      );
    index = orderedImages.findIndex((candidate) => candidate._id === media._id);
  }
  if (index < 0 || index >= imageUrls.length) return;

  imageUrls.splice(index, 1);
  const imageMimeTypes = [...(message.imageMimeTypes ?? [])];
  if (index < imageMimeTypes.length) imageMimeTypes.splice(index, 1);
  await ctx.db.patch(message._id, { imageUrls, imageMimeTypes });
}

/** Deletes every owned reference for one deduplicated Knowledge Base media row. */
export async function deleteGeneratedMediaKnowledgeBaseFile(
  ctx: MutationCtx,
  userId: string,
  storageId: Id<"_storage">,
): Promise<boolean> {
  const mediaRows = await ctx.db
    .query("generatedMedia")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .collect();
  const ownedMedia = mediaRows.filter((media) => media.userId === userId);
  if (ownedMedia.length === 0) return false;
  const mayDeleteStorage = ownedMedia.every(isGeneratedMediaReferenceFullyTracked);

  // A fork/copy has a distinct generatedMedia row but intentionally shares the
  // immutable blob. KB deletion is file-scoped, so remove every owned message
  // reference before deleting the shared file.
  for (const media of ownedMedia) {
    await removeGeneratedMediaFromMessage(ctx, media);
    await deleteDocumentForDeletedRecord(ctx, userId, {
      storageId,
      generatedMediaId: media._id,
    });
  }
  for (const media of ownedMedia) {
    await ctx.db.delete(media._id);
  }
  if (mayDeleteStorage && !(await storageHasContentReferences(ctx, storageId))) {
    await deleteDriveGrantCacheForStorage(ctx, userId, storageId);
    try {
      await ctx.storage.delete(storageId);
    } catch {
      // Storage blob may already be gone.
    }
  }
  return true;
}
