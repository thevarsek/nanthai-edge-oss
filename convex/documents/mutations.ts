import { internalMutation, mutation, MutationCtx } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";
import {
  CanonicalDocumentSource,
  isReadableDocumentMime,
  versionSourceForDocumentSource,
} from "./shared";
import { requireAuth } from "../lib/auth";

type EnsureRecordInput = {
  source: CanonicalDocumentSource;
  storageId: Id<"_storage">;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  chatId?: Id<"chats">;
  folderId?: Id<"folders">;
  fileAttachmentId?: Id<"fileAttachments">;
  generatedFileId?: Id<"generatedFiles">;
  driveFileId?: string;
  externalModifiedTime?: string;
};

async function ensureDocumentForRecord(
  ctx: MutationCtx,
  userId: string,
  input: EnsureRecordInput,
): Promise<{
  documentId: Id<"documents">;
  versionId: Id<"documentVersions">;
  versionNumber: number;
}> {
  const now = Date.now();
  const candidates = await Promise.all([
    input.fileAttachmentId
      ? ctx.db
        .query("documents")
        .withIndex("by_file_attachment", (q) => q.eq("fileAttachmentId", input.fileAttachmentId!))
        .first()
      : Promise.resolve(null),
    input.generatedFileId
      ? ctx.db
        .query("documents")
        .withIndex("by_generated_file", (q) => q.eq("generatedFileId", input.generatedFileId!))
        .first()
      : Promise.resolve(null),
    ctx.db
      .query("documents")
      .withIndex("by_source_storage", (q) => q.eq("sourceStorageId", input.storageId))
      .first(),
  ]);
  const existing = candidates.find((candidate) => {
    if (!candidate || candidate.userId !== userId) return false;
    if (input.fileAttachmentId && candidate.fileAttachmentId === input.fileAttachmentId) return true;
    if (input.generatedFileId && candidate.generatedFileId === input.generatedFileId) return true;
    return !candidate.originChatId || candidate.originChatId === input.chatId;
  }) ?? null;

  if (existing && existing.userId === userId) {
    const currentVersion = existing.currentVersionId
      ? await ctx.db.get(existing.currentVersionId)
      : null;
    if (currentVersion) {
      const patch: Record<string, unknown> = {};
      if (input.folderId !== existing.folderId) patch.folderId = input.folderId;
      if (input.externalModifiedTime && input.externalModifiedTime !== existing.externalModifiedTime) {
        patch.externalModifiedTime = input.externalModifiedTime;
      }
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = now;
        await ctx.db.patch(existing._id, patch);
      }
      return {
        documentId: existing._id,
        versionId: currentVersion._id,
        versionNumber: currentVersion.versionNumber,
      };
    }
  }

  const documentId = existing && existing.userId === userId
    ? existing._id
    : await ctx.db.insert("documents", {
      userId,
      title: input.filename,
      filename: input.filename,
      mimeType: input.mimeType,
      source: input.source,
      originChatId: input.chatId,
      folderId: input.folderId,
      sourceStorageId: input.storageId,
      fileAttachmentId: input.fileAttachmentId,
      generatedFileId: input.generatedFileId,
      driveFileId: input.driveFileId,
      externalModifiedTime: input.externalModifiedTime,
      status: "ready",
      syncState: input.source === "drive" ? "current" : undefined,
      createdAt: now,
      updatedAt: now,
    });

  const versionId = await ctx.db.insert("documentVersions", {
    documentId,
    userId,
    storageId: input.storageId,
    filename: input.filename,
    mimeType: input.mimeType,
    versionNumber: 1,
    source: versionSourceForDocumentSource(input.source),
    extractionStatus: "pending",
    externalModifiedTime: input.externalModifiedTime,
    createdAt: now,
  });

  await ctx.db.patch(documentId, {
    currentVersionId: versionId,
    externalSyncedVersionId: input.source === "drive" ? versionId : undefined,
    updatedAt: now,
  });

  return { documentId, versionId, versionNumber: 1 };
}

export const ensureDocumentsForChat = internalMutation({
  args: {
    userId: v.string(),
    chatId: v.id("chats"),
  },
  returns: v.array(v.object({
    ref: v.string(),
    documentId: v.id("documents"),
    versionId: v.optional(v.id("documentVersions")),
    filename: v.string(),
    title: v.string(),
    mimeType: v.string(),
    source: v.union(v.literal("upload"), v.literal("generated"), v.literal("drive")),
    storageId: v.id("_storage"),
    versionNumber: v.optional(v.number()),
    extractionStatus: v.optional(v.string()),
    extractionTextStorageId: v.optional(v.id("_storage")),
    syncState: v.optional(v.string()),
    driveFileId: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== args.userId) return [];
    const folderId = chat.folderId ? chat.folderId as Id<"folders"> : undefined;

    const attachments = await ctx.db
      .query("fileAttachments")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();
    const generatedFiles = await ctx.db
      .query("generatedFiles")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();

    const scoped: Array<{
      ref: string;
      documentId: Id<"documents">;
      versionId?: Id<"documentVersions">;
      filename: string;
      title: string;
      mimeType: string;
      source: "upload" | "generated" | "drive";
      storageId: Id<"_storage">;
      versionNumber?: number;
      extractionStatus?: string;
      extractionTextStorageId?: Id<"_storage">;
      syncState?: string;
      driveFileId?: string;
    }> = [];

    const candidates: EnsureRecordInput[] = [];
    for (const attachment of attachments) {
      if (attachment.userId !== args.userId) continue;
      if (!isReadableDocumentMime(attachment.mimeType, attachment.filename)) continue;
      candidates.push({
        source: attachment.driveFileId ? "drive" : "upload",
        storageId: attachment.storageId,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        chatId: args.chatId,
        folderId,
        fileAttachmentId: attachment._id,
        driveFileId: attachment.driveFileId,
      });
    }
    for (const file of generatedFiles) {
      if (file.userId !== args.userId) continue;
      if (!isReadableDocumentMime(file.mimeType, file.filename)) continue;
      candidates.push({
        source: "generated",
        storageId: file.storageId,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        chatId: args.chatId,
        folderId,
        generatedFileId: file._id,
      });
    }

    for (const candidate of candidates) {
      const ensured = await ensureDocumentForRecord(ctx, args.userId, candidate);
      const version = await ctx.db.get(ensured.versionId);
      const document = await ctx.db.get(ensured.documentId);
      if (!document) continue;
      scoped.push({
        ref: `doc-${scoped.length}`,
        documentId: ensured.documentId,
        versionId: ensured.versionId,
        filename: document.filename,
        title: document.title,
        mimeType: document.mimeType,
        source: document.source,
        storageId: version?.storageId ?? candidate.storageId,
        versionNumber: ensured.versionNumber,
        extractionStatus: version?.extractionStatus,
        extractionTextStorageId: version?.extractionTextStorageId,
        syncState: document.syncState,
        driveFileId: document.driveFileId,
      });
    }

    return scoped;
  },
});

export const updateVersionExtraction = internalMutation({
  args: {
    versionId: v.id("documentVersions"),
    status: v.union(
      v.literal("pending"),
      v.literal("extracting"),
      v.literal("ready"),
      v.literal("error"),
      v.literal("unsupported"),
    ),
    extractionTextStorageId: v.optional(v.id("_storage")),
    extractionMarkdownStorageId: v.optional(v.id("_storage")),
    extractionByteLength: v.optional(v.number()),
    extractionError: v.optional(v.string()),
    pageCount: v.optional(v.number()),
    wordCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) return null;
    await ctx.db.patch(args.versionId, {
      extractionStatus: args.status,
      extractionTextStorageId: args.extractionTextStorageId,
      extractionMarkdownStorageId: args.extractionMarkdownStorageId,
      extractionByteLength: args.extractionByteLength,
      extractionError: args.extractionError,
      pageCount: args.pageCount,
      wordCount: args.wordCount,
    });
    await ctx.db.patch(version.documentId, {
      status: args.status === "error" || args.status === "unsupported" ? "error" : "ready",
      lastExtractedAt: args.status === "ready" ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const syncDocumentFoldersForChat = internalMutation({
  args: {
    userId: v.string(),
    chatId: v.id("chats"),
    folderId: v.optional(v.id("folders")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const documents = await ctx.db
      .query("documents")
      .withIndex("by_origin_chat", (q) => q.eq("originChatId", args.chatId))
      .collect();
    for (const document of documents) {
      if (document.userId !== args.userId) continue;
      await ctx.db.patch(document._id, {
        folderId: args.folderId,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

export const makeCurrentVersion = mutation({
  args: {
    documentId: v.id("documents"),
    versionId: v.id("documentVersions"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const document = await ctx.db.get(args.documentId);
    if (!document || document.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document not found or unauthorized." });
    }
    const version = await ctx.db.get(args.versionId);
    if (!version || version.userId !== userId || version.documentId !== args.documentId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document version not found or unauthorized." });
    }

    const isExternalSyncedVersion = document.externalSyncedVersionId === args.versionId;
    const syncState = isExternalSyncedVersion
      ? (version.source === "drive_refresh" ? "updated_from_drive" : "current")
      : version.source === "assistant_edit"
        ? "local_ahead"
        : document.syncState;

    await ctx.db.patch(args.documentId, {
      currentVersionId: args.versionId,
      filename: version.filename,
      mimeType: version.mimeType,
      sourceStorageId: version.storageId,
      externalModifiedTime: version.externalModifiedTime,
      syncState,
      updatedAt: Date.now(),
    });
    return null;
  },
});
