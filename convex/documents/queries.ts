import { internalQuery, query } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";

export const getVersionForExtraction = internalQuery({
  args: {
    versionId: v.id("documentVersions"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("documentVersions"),
      documentId: v.id("documents"),
      userId: v.string(),
      storageId: v.id("_storage"),
      filename: v.string(),
      mimeType: v.string(),
      versionNumber: v.number(),
      extractionStatus: v.string(),
      extractionTextStorageId: v.optional(v.id("_storage")),
      extractionMarkdownStorageId: v.optional(v.id("_storage")),
      pageCount: v.optional(v.number()),
      wordCount: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) return null;
    return {
      _id: version._id,
      documentId: version.documentId,
      userId: version.userId,
      storageId: version.storageId,
      filename: version.filename,
      mimeType: version.mimeType,
      versionNumber: version.versionNumber,
      extractionStatus: version.extractionStatus,
      extractionTextStorageId: version.extractionTextStorageId,
      extractionMarkdownStorageId: version.extractionMarkdownStorageId,
      pageCount: version.pageCount,
      wordCount: version.wordCount,
    };
  },
});

export const listDocumentVersions = query({
  args: {
    documentId: v.id("documents"),
  },
  returns: v.array(v.object({
    _id: v.id("documentVersions"),
    documentId: v.id("documents"),
    filename: v.string(),
    mimeType: v.string(),
    versionNumber: v.number(),
    source: v.string(),
    extractionStatus: v.string(),
    pageCount: v.optional(v.number()),
    wordCount: v.optional(v.number()),
    externalModifiedTime: v.optional(v.string()),
    downloadUrl: v.union(v.string(), v.null()),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const document = await ctx.db.get(args.documentId);
    if (!document || document.userId !== userId) return [];
    const versions = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    return await Promise.all(versions.map(async (version) => ({
      _id: version._id,
      documentId: version.documentId,
      filename: version.filename,
      mimeType: version.mimeType,
      versionNumber: version.versionNumber,
      source: version.source,
      extractionStatus: version.extractionStatus,
      pageCount: version.pageCount,
      wordCount: version.wordCount,
      externalModifiedTime: version.externalModifiedTime,
      downloadUrl: await ctx.storage.getUrl(version.storageId),
      createdAt: version.createdAt,
    })));
  },
});

export const getDocumentVersionDownloadUrl = query({
  args: {
    versionId: v.id("documentVersions"),
  },
  returns: v.union(
    v.null(),
    v.object({
      versionId: v.id("documentVersions"),
      documentId: v.id("documents"),
      filename: v.string(),
      mimeType: v.string(),
      downloadUrl: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const version = await ctx.db.get(args.versionId);
    if (!version || version.userId !== userId) return null;
    const document = await ctx.db.get(version.documentId);
    if (!document || document.userId !== userId) return null;
    return {
      versionId: version._id,
      documentId: version.documentId,
      filename: version.filename,
      mimeType: version.mimeType,
      downloadUrl: await ctx.storage.getUrl(version.storageId),
    };
  },
});

export const getDocument = query({
  args: {
    documentId: v.id("documents"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("documents"),
      title: v.string(),
      filename: v.string(),
      mimeType: v.string(),
      source: v.string(),
      currentVersionId: v.optional(v.id("documentVersions")),
      originChatId: v.optional(v.id("chats")),
      folderId: v.optional(v.id("folders")),
      status: v.string(),
      syncState: v.optional(v.string()),
      driveFileId: v.optional(v.string()),
      externalModifiedTime: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const document = await ctx.db.get(args.documentId);
    if (!document || document.userId !== userId) return null;
    return {
      _id: document._id,
      title: document.title,
      filename: document.filename,
      mimeType: document.mimeType,
      source: document.source,
      currentVersionId: document.currentVersionId as Id<"documentVersions"> | undefined,
      originChatId: document.originChatId,
      folderId: document.folderId,
      status: document.status,
      syncState: document.syncState,
      driveFileId: document.driveFileId,
      externalModifiedTime: document.externalModifiedTime,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  },
});

export const getDocumentEditResolutionTarget = internalQuery({
  args: {
    userId: v.string(),
    documentId: v.id("documents"),
    editId: v.id("documentEdits"),
  },
  handler: async (ctx, args) => {
    const edit = await ctx.db.get(args.editId);
    const document = await ctx.db.get(args.documentId);
    if (!edit || !document || edit.userId !== args.userId || document.userId !== args.userId || edit.documentId !== args.documentId) {
      return null;
    }
    const batch = await ctx.db.get(edit.batchId);
    if (!batch || batch.userId !== args.userId || batch.documentId !== args.documentId) return null;
    const edits = await ctx.db
      .query("documentEdits")
      .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
      .collect();
    const remainingPending = edits.filter((batchEdit) => batchEdit.status === "pending").length;
    if (edit.status !== "pending") {
      return {
        alreadyResolved: true,
        status: edit.status,
        batchId: batch._id,
        currentVersionId: batch.currentVersionId,
        resolvedVersionId: edit.resolvedVersionId,
        preResolutionVersionId: edit.preResolutionVersionId,
        generatedFileId: batch.generatedFileId,
        remainingPending,
      };
    }
    if (document.currentVersionId !== batch.currentVersionId) {
      return { superseded: true, status: edit.status, batchId: batch._id };
    }
    const currentVersion = await ctx.db.get(batch.currentVersionId);
    if (!currentVersion) return null;
    return {
      alreadyResolved: false,
      status: edit.status,
      batchId: batch._id,
      currentVersionId: currentVersion._id,
      storageId: currentVersion.storageId,
      filename: currentVersion.filename,
      mimeType: currentVersion.mimeType,
      changeIds: [edit.changeId, edit.delWId, edit.insWId].filter((id): id is string => Boolean(id)),
      remainingPending,
    };
  },
});

export const getDocumentEditBatchUsage = internalQuery({
  args: {
    userId: v.string(),
    generationKey: v.string(),
    documentId: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query("documentEditBatches")
      .withIndex("by_generation_document", (q) => q.eq("generationKey", args.generationKey).eq("documentId", args.documentId))
      .first();
    if (!batch || batch.userId !== args.userId) return { editCount: 0 };
    const edits = await ctx.db
      .query("documentEdits")
      .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
      .collect();
    return { editCount: edits.length };
  },
});
