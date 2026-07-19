import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function storageHasContentReferences(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
): Promise<boolean> {
  const [fileAttachmentRef, generatedFileRef, generatedMediaRef] =
    await Promise.all([
      ctx.db
        .query("fileAttachments")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .first(),
      ctx.db
        .query("generatedFiles")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .first(),
      ctx.db
        .query("generatedMedia")
        .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
        .first(),
    ]);
  return !!(fileAttachmentRef || generatedFileRef || generatedMediaRef);
}

export async function storageHasSourceReferences(
  ctx: MutationCtx,
  userId: string,
  storageId: Id<"_storage">,
): Promise<boolean> {
  const [hasContentReference, driveGrantRef] = await Promise.all([
    storageHasContentReferences(ctx, storageId),
    ctx.db
      .query("googleDriveFileGrants")
      .withIndex("by_user_cached_storage", (q) =>
        q.eq("userId", userId).eq("cachedStorageId", storageId)
      )
      .first(),
  ]);
  return hasContentReference || !!driveGrantRef;
}

/**
 * Reference check used after deleting one upload/session/version row. It
 * includes the durable source tables omitted from the content-only helper so
 * shared KB and document-version blobs are not reclaimed prematurely.
 */
export async function storageHasDurableReferences(
  ctx: MutationCtx,
  userId: string,
  storageId: Id<"_storage">,
): Promise<boolean> {
  const [hasSourceReference, documentVersionRef, uploadSessionRef] = await Promise.all([
    storageHasSourceReferences(ctx, userId, storageId),
    ctx.db
      .query("documentVersions")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first(),
    ctx.db
      .query("kbUploadSessions")
      .withIndex("by_user_storage", (q) => q.eq("userId", userId).eq("storageId", storageId))
      .first(),
  ]);
  return hasSourceReference || !!documentVersionRef || !!uploadSessionRef;
}

export async function deleteDocumentForDeletedRecord(
  ctx: MutationCtx,
  userId: string,
  input: {
    storageId: Id<"_storage">;
    fileAttachmentId?: Id<"fileAttachments">;
    generatedFileId?: Id<"generatedFiles">;
    generatedMediaId?: Id<"generatedMedia">;
  },
): Promise<void> {
  const document = input.fileAttachmentId
    ? await ctx.db
      .query("documents")
      .withIndex("by_file_attachment", (q) => q.eq("fileAttachmentId", input.fileAttachmentId))
      .first()
    : input.generatedFileId
      ? await ctx.db
        .query("documents")
        .withIndex("by_generated_file", (q) => q.eq("generatedFileId", input.generatedFileId))
        .first()
      : input.generatedMediaId
        ? await ctx.db
          .query("documents")
          .withIndex("by_generated_media", (q) => q.eq("generatedMediaId", input.generatedMediaId))
          .first()
        : await ctx.db
          .query("documents")
          .withIndex("by_source_storage", (q) => q.eq("sourceStorageId", input.storageId))
          .first();
  if (!document || document.userId !== userId) return;

  const editBatches = await ctx.db
    .query("documentEditBatches")
    .withIndex("by_document", (q) => q.eq("documentId", document._id))
    .collect();
  for (const batch of editBatches) {
    const edits = await ctx.db
      .query("documentEdits")
      .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
      .collect();
    for (const edit of edits) {
      await ctx.db.delete(edit._id);
    }
    await ctx.db.delete(batch._id);
  }

  const versions = await ctx.db
    .query("documentVersions")
    .withIndex("by_document", (q) => q.eq("documentId", document._id))
    .collect();
  for (const version of versions) {
    if (version.storageId !== input.storageId) {
      const hasSourceRef = await storageHasSourceReferences(
        ctx,
        userId,
        version.storageId,
      );
      if (!hasSourceRef) {
        try {
          await ctx.storage.delete(version.storageId);
        } catch {
          // Storage blob may already be gone.
        }
      }
    }
    if (version.extractionTextStorageId) {
      try {
        await ctx.storage.delete(version.extractionTextStorageId);
      } catch {
        // Storage blob may already be gone.
      }
    }
    if (version.extractionMarkdownStorageId) {
      try {
        await ctx.storage.delete(version.extractionMarkdownStorageId);
      } catch {
        // Storage blob may already be gone.
      }
    }
    await ctx.db.delete(version._id);
  }
  await ctx.db.delete(document._id);
}
