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
