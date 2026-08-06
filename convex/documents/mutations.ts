import { internalMutation, mutation, MutationCtx } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import {
  CanonicalDocumentSource,
  isReadableDocumentMime,
  versionSourceForDocumentSource,
} from "./shared";
import { requireAuth } from "../lib/auth";
import { hydrateDocumentEditAnnotation } from "./docx_edit_annotations";

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

const MAX_DOCX_EDITS_PER_TURN = 100;

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
    const isDriveBacked = document.source === "drive" || Boolean(document.driveFileId);
    const syncState = isExternalSyncedVersion
      ? (version.source === "drive_refresh" ? "updated_from_drive" : "current")
      : version.source === "assistant_edit"
        ? (isDriveBacked ? "local_ahead" : document.syncState)
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

async function nextDocumentVersionNumber(
  ctx: MutationCtx,
  documentId: Id<"documents">,
): Promise<number> {
  const latest = await ctx.db
    .query("documentVersions")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .order("desc")
    .first();
  return (latest?.versionNumber ?? 0) + 1;
}

async function advanceDocumentToVersion(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  versionId: Id<"documentVersions">,
): Promise<void> {
  const version = await ctx.db.get(versionId);
  if (!version) return;
  const document = await ctx.db.get(documentId);
  const patch: Partial<Doc<"documents">> = {
    currentVersionId: versionId,
    filename: version.filename,
    mimeType: version.mimeType,
    sourceStorageId: version.storageId,
    status: "ready",
    updatedAt: Date.now(),
  };
  if (document?.source === "drive" || document?.driveFileId) {
    patch.syncState = "local_ahead";
  }
  await ctx.db.patch(documentId, patch);
}

async function upsertBatchGeneratedFile(
  ctx: MutationCtx,
  args: {
    userId: string;
    documentId: Id<"documents">;
    batchId: Id<"documentEditBatches">;
    chatId?: Id<"chats">;
    messageId?: Id<"messages">;
    generatedFileId?: Id<"generatedFiles">;
    versionId: Id<"documentVersions">;
    sizeBytes?: number;
  },
): Promise<Id<"generatedFiles"> | undefined> {
  const version = await ctx.db.get(args.versionId);
  if (!version) return args.generatedFileId;
  const sizePatch = args.sizeBytes === undefined ? {} : { sizeBytes: args.sizeBytes };
  if (args.generatedFileId) {
    await ctx.db.patch(args.generatedFileId, {
      storageId: version.storageId,
      filename: version.filename,
      mimeType: version.mimeType,
      documentId: args.documentId,
      documentVersionId: args.versionId,
      ...sizePatch,
    });
    return args.generatedFileId;
  }
  if (!args.chatId || !args.messageId) return undefined;
  const generatedFileId = await ctx.db.insert("generatedFiles", {
    userId: args.userId,
    chatId: args.chatId,
    messageId: args.messageId,
    storageId: version.storageId,
    filename: version.filename,
    mimeType: version.mimeType,
    sizeBytes: args.sizeBytes,
    toolName: "propose_docx_edits",
    documentId: args.documentId,
    documentVersionId: args.versionId,
    createdAt: Date.now(),
  });
  await ctx.db.patch(args.batchId, { generatedFileId, updatedAt: Date.now() });
  await ctx.db.patch(args.documentId, { generatedFileId, updatedAt: Date.now() });
  return generatedFileId;
}

export const commitProposedDocxEdits = internalMutation({
  args: {
    userId: v.string(),
    chatId: v.optional(v.id("chats")),
    messageId: v.optional(v.id("messages")),
    generationKey: v.string(),
    documentId: v.id("documents"),
    sourceVersionId: v.id("documentVersions"),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
    changes: v.array(v.object({
      changeId: v.string(),
      delWId: v.optional(v.string()),
      insWId: v.optional(v.string()),
      deletedText: v.string(),
      insertedText: v.string(),
      contextBefore: v.optional(v.string()),
      contextAfter: v.optional(v.string()),
      reason: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    const sourceVersion = await ctx.db.get(args.sourceVersionId);
    if (!document || document.userId !== args.userId || !sourceVersion || sourceVersion.userId !== args.userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document not found or unauthorized." });
    }
    if (sourceVersion.documentId !== args.documentId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Source version does not belong to this document." });
    }
    const generationBatch = await ctx.db
      .query("documentEditBatches")
      .withIndex("by_generation", (q) => q.eq("generationKey", args.generationKey))
      .first();
    if (generationBatch && generationBatch.documentId !== args.documentId) {
      throw new ConvexError({
        code: "DOCX_TARGET_ALREADY_SELECTED",
        message:
          "This assistant turn already proposed DOCX edits for another document. " +
          "Do not create a second output file; continue with the original target or ask the user to start a new edit turn.",
      });
    }
    if (document.currentVersionId && document.currentVersionId !== args.sourceVersionId) {
      throw new ConvexError({
        code: "SUPERSEDED_VERSION",
        message: "This document changed before the tracked changes could be committed. Read the latest version and try again.",
      });
    }
    const now = Date.now();
    let batch = await ctx.db
      .query("documentEditBatches")
      .withIndex("by_generation_document", (q) => q.eq("generationKey", args.generationKey).eq("documentId", args.documentId))
      .first();
    let existingBatchEdits: Array<Doc<"documentEdits">> = [];
    if (batch) {
      const batchId = batch._id;
      existingBatchEdits = await ctx.db
        .query("documentEdits")
        .withIndex("by_batch", (q) => q.eq("batchId", batchId))
        .collect();
    }
    if (existingBatchEdits.length + args.changes.length > MAX_DOCX_EDITS_PER_TURN) {
      throw new ConvexError({
        code: "VALIDATION_ERROR",
        message: `At most ${MAX_DOCX_EDITS_PER_TURN} DOCX tracked-change edits are allowed per assistant turn for one document.`,
      });
    }
    const reusedBatchStatus = existingBatchEdits.some((edit) => edit.status !== "pending")
      ? "partially_resolved"
      : "pending";
    const versionId = await ctx.db.insert("documentVersions", {
      documentId: args.documentId,
      userId: args.userId,
      storageId: args.storageId,
      filename: args.filename,
      mimeType: args.mimeType,
      versionNumber: await nextDocumentVersionNumber(ctx, args.documentId),
      source: "assistant_edit",
      parentVersionId: document.currentVersionId ?? args.sourceVersionId,
      extractionStatus: "pending",
      createdAt: now,
    });
    if (!batch) {
      const batchId = await ctx.db.insert("documentEditBatches", {
        userId: args.userId,
        documentId: args.documentId,
        assistantMessageId: args.messageId,
        generationKey: args.generationKey,
        baseVersionId: args.sourceVersionId,
        currentVersionId: versionId,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      batch = await ctx.db.get(batchId);
    } else {
      await ctx.db.patch(batch._id, {
        currentVersionId: versionId,
        assistantMessageId: batch.assistantMessageId ?? args.messageId,
        status: reusedBatchStatus,
        updatedAt: now,
      });
      batch = await ctx.db.get(batch._id);
    }
    if (!batch) throw new ConvexError({ code: "INTERNAL_ERROR", message: "Failed to create edit batch." });
    await advanceDocumentToVersion(ctx, args.documentId, versionId);
    const generatedFileId = await upsertBatchGeneratedFile(ctx, {
      userId: args.userId,
      documentId: args.documentId,
      batchId: batch._id,
      chatId: args.chatId,
      messageId: args.messageId,
      generatedFileId: batch.generatedFileId,
      versionId,
      sizeBytes: args.sizeBytes,
    });
    const annotations = [];
    for (const change of args.changes) {
      const editId = await ctx.db.insert("documentEdits", {
        userId: args.userId,
        documentId: args.documentId,
        batchId: batch._id,
        assistantMessageId: args.messageId,
        introducedVersionId: versionId,
        changeId: change.changeId,
        delWId: change.delWId,
        insWId: change.insWId,
        deletedText: change.deletedText,
        insertedText: change.insertedText,
        contextBefore: change.contextBefore,
        contextAfter: change.contextAfter,
        reason: change.reason,
        status: "pending",
        createdAt: now,
      });
      annotations.push(await hydrateDocumentEditAnnotation(ctx, {
        type: "docx_edit_proposed",
        editId,
        editBatchId: batch._id,
        generationKey: args.generationKey,
        documentId: args.documentId,
        versionId,
        baseVersionId: batch.baseVersionId,
        introducedVersionId: versionId,
        generatedFileId,
        filename: args.filename,
        versionNumber: 0,
        changeId: change.changeId,
        deletedText: change.deletedText,
        insertedText: change.insertedText,
        contextBefore: change.contextBefore,
        contextAfter: change.contextAfter,
        reason: change.reason,
        status: "pending",
        displayStatus: "pending",
        canUndo: false,
      }));
    }
    if (args.messageId) {
      const message = await ctx.db.get(args.messageId);
      const existingIds = message?.generatedFileIds ?? [];
      const nextIds = generatedFileId && !existingIds.includes(generatedFileId)
        ? [...existingIds, generatedFileId]
        : existingIds;
      const existingEvents = message?.documentEvents ?? [];
      const existingAnnotations = message?.documentEditAnnotations ?? [];
      await ctx.db.patch(args.messageId, {
        generatedFileIds: nextIds.length > 0 ? nextIds : undefined,
        documentEvents: [
          ...existingEvents,
          {
            type: "document_updated",
            documentId: args.documentId,
            versionId,
            storageId: args.storageId,
            generatedFileId,
            filename: args.filename,
            mimeType: args.mimeType,
            sizeBytes: args.sizeBytes,
          },
        ],
        documentEditAnnotations: [...existingAnnotations, ...annotations],
      });
    }
    return { batchId: batch._id, versionId, generatedFileId, annotations };
  },
});

async function remainingPending(ctx: MutationCtx, batchId: Id<"documentEditBatches">): Promise<number> {
  const edits = await ctx.db
    .query("documentEdits")
    .withIndex("by_batch", (q) => q.eq("batchId", batchId))
    .collect();
  return edits.filter((edit) => edit.status === "pending").length;
}

export const commitResolvedDocumentEdit = internalMutation({
  args: {
    userId: v.string(),
    documentId: v.id("documents"),
    editId: v.id("documentEdits"),
    decision: v.union(v.literal("accept"), v.literal("reject")),
    previousVersionId: v.id("documentVersions"),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const edit = await ctx.db.get(args.editId);
    const document = await ctx.db.get(args.documentId);
    if (!edit || !document || edit.userId !== args.userId || document.userId !== args.userId || edit.documentId !== args.documentId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document edit not found or unauthorized." });
    }
    const batch = await ctx.db.get(edit.batchId);
    if (!batch || batch.userId !== args.userId || batch.documentId !== args.documentId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document edit batch not found." });
    }
    if (edit.status !== "pending") {
      return {
        ok: true,
        editId: args.editId,
        status: edit.status,
        alreadyResolved: true,
        documentId: args.documentId,
        versionId: edit.resolvedVersionId ?? batch.currentVersionId,
        previousVersionId: edit.preResolutionVersionId ?? batch.currentVersionId,
        generatedFileId: batch.generatedFileId ?? null,
        remainingPending: await remainingPending(ctx, batch._id),
        downloadUrl: null,
      };
    }
    if (document.currentVersionId !== batch.currentVersionId) {
      throw new ConvexError({ code: "SUPERSEDED_VERSION", message: "This edit batch is no longer the current document version." });
    }
    if (batch.currentVersionId !== args.previousVersionId) {
      throw new ConvexError({ code: "SUPERSEDED_VERSION", message: "This edit batch changed while resolving the edit." });
    }
    const now = Date.now();
    const versionId = await ctx.db.insert("documentVersions", {
      documentId: args.documentId,
      userId: args.userId,
      storageId: args.storageId,
      filename: args.filename,
      mimeType: args.mimeType,
      versionNumber: await nextDocumentVersionNumber(ctx, args.documentId),
      source: "assistant_edit",
      parentVersionId: batch.currentVersionId,
      extractionStatus: "pending",
      createdAt: now,
    });
    await ctx.db.patch(edit._id, {
      status: args.decision === "accept" ? "accepted" : "rejected",
      preResolutionVersionId: batch.currentVersionId,
      resolvedVersionId: versionId,
      resolvedAt: now,
      resolvedBy: args.userId,
    });
    await ctx.db.patch(batch._id, { currentVersionId: versionId, status: "partially_resolved", updatedAt: now });
    await advanceDocumentToVersion(ctx, args.documentId, versionId);
    const generatedFileId = await upsertBatchGeneratedFile(ctx, {
      userId: args.userId,
      documentId: args.documentId,
      batchId: batch._id,
      generatedFileId: batch.generatedFileId,
      versionId,
      sizeBytes: args.sizeBytes,
    });
    const pending = await remainingPending(ctx, batch._id);
    if (pending === 0) await ctx.db.patch(batch._id, { status: "resolved", updatedAt: now });
    return {
      ok: true,
      editId: args.editId,
      status: args.decision === "accept" ? "accepted" : "rejected",
      alreadyResolved: false,
      documentId: args.documentId,
      versionId,
      previousVersionId: args.previousVersionId,
      generatedFileId: generatedFileId ?? null,
      remainingPending: pending,
      downloadUrl: null,
    };
  },
});

export const undoDocumentEditResolution = mutation({
  args: {
    documentId: v.id("documents"),
    editId: v.id("documentEdits"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const edit = await ctx.db.get(args.editId);
    const document = await ctx.db.get(args.documentId);
    if (!edit || !document || edit.userId !== userId || document.userId !== userId || edit.documentId !== args.documentId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document edit not found or unauthorized." });
    }
    const batch = await ctx.db.get(edit.batchId);
    if (!batch) throw new ConvexError({ code: "NOT_FOUND", message: "Document edit batch not found." });
    if (edit.status === "pending") {
      return {
        ok: true,
        editId: args.editId,
        status: "pending",
        documentId: args.documentId,
        versionId: batch.currentVersionId,
        undoneResolvedVersionId: null,
        generatedFileId: batch.generatedFileId ?? null,
        remainingPending: await remainingPending(ctx, batch._id),
        downloadUrl: null,
      };
    }
    if (!edit.preResolutionVersionId || !edit.resolvedVersionId || edit.resolvedVersionId !== batch.currentVersionId || document.currentVersionId !== batch.currentVersionId) {
      throw new ConvexError({ code: "UNDO_NOT_AVAILABLE", message: "Only the latest resolved edit can be undone." });
    }
    await ctx.db.patch(edit._id, {
      status: "pending",
      preResolutionVersionId: undefined,
      resolvedVersionId: undefined,
      resolvedAt: undefined,
      resolvedBy: undefined,
    });
    const batchEdits = await ctx.db
      .query("documentEdits")
      .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
      .collect();
    const pendingAfterUndo = batchEdits.filter((batchEdit) =>
      batchEdit._id === edit._id || batchEdit.status === "pending"
    ).length;
    const batchStatus = pendingAfterUndo === batchEdits.length ? "pending" : "partially_resolved";
    await ctx.db.patch(batch._id, {
      currentVersionId: edit.preResolutionVersionId,
      status: batchStatus,
      updatedAt: Date.now(),
    });
    await advanceDocumentToVersion(ctx, args.documentId, edit.preResolutionVersionId);
    const generatedFileId = await upsertBatchGeneratedFile(ctx, {
      userId,
      documentId: args.documentId,
      batchId: batch._id,
      generatedFileId: batch.generatedFileId,
      versionId: edit.preResolutionVersionId,
    });
    return {
      ok: true,
      editId: args.editId,
      status: "pending",
      documentId: args.documentId,
      versionId: edit.preResolutionVersionId,
      undoneResolvedVersionId: edit.resolvedVersionId,
      generatedFileId: generatedFileId ?? null,
      remainingPending: pendingAfterUndo,
      downloadUrl: null,
    };
  },
});
