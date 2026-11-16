import { assertOwnedStorage } from "../lib/storage_ownership";
// convex/knowledge_base/mutations.ts
// =============================================================================
// Knowledge Base mutations.
//
// Owns all Settings-KB write paths plus the unified delete that handles
// generated/upload/drive sources. Drive import is split into action+mutation
// (see `actions.ts`) so the HTTP fetch lives in the action.
//
// Per `docs/architecture/client-convex-contract.md`, web/iOS/Android all call the same
// mutations here for KB writes — no parallel client-specific paths.
// =============================================================================

import { mutation, MutationCtx } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import {
  insertFileAttachment,
  deleteDriveGrantCacheForStorage,
  storageHasOtherFileAttachmentReferences,
} from "../lib/file_attachments";
import {
  addUploadToKnowledgeBaseArgs,
  deleteKnowledgeBaseFileArgs,
} from "./mutations_args";
import {
  deleteDocumentForDeletedRecord,
  storageHasContentReferences,
} from "./delete_helpers";
import { deleteGeneratedMediaKnowledgeBaseFile } from "./generated_media_delete";

const MAX_KB_FILE_BYTES = 25 * 1024 * 1024;

// MARK: - addUploadToKnowledgeBase

/**
 * Register a previously-uploaded `_storage` blob as a Knowledge Base file.
 *
 * Client flow:
 *   1. Call `createKnowledgeBaseUploadUrl` → upload bytes via PUT → get `storageId`.
 *   2. Bind the upload session to the returned `storageId`.
 *   3. Call this mutation with the `storageId`, upload session, filename, and mimeType.
 *
 * The row is inserted with no `chatId`/`messageId` (= Settings KB scope) and
 * no `driveFileId` (= `source: "upload"` in KB listings).
 */
export const addUploadToKnowledgeBase = mutation({
  args: addUploadToKnowledgeBaseArgs,
  returns: v.id("fileAttachments"),
  handler: async (ctx, args): Promise<Id<"fileAttachments">> => {
    const { userId } = await requireAuth(ctx);

    if (typeof args.sizeBytes === "number" && args.sizeBytes > MAX_KB_FILE_BYTES) {
      throw new ConvexError({
        code: "VALIDATION" as const,
        message: "File is too large to add to the Knowledge Base.",
      });
    }

    const session = await ctx.db.get(args.uploadSessionId);
    if (
      !session ||
      session.userId !== userId ||
      session.status !== "pending" ||
      session.storageId !== args.storageId
    ) {
      throw new ConvexError({
        code: "FORBIDDEN" as const,
        message: "Upload session is missing or does not match this file.",
      });
    }

    const existing = await ctx.db
      .query("fileAttachments")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();
    if (existing) {
      throw new ConvexError({
        code: "VALIDATION" as const,
        message: "This uploaded file is already registered.",
      });
    }

    const fileAttachmentId = await insertFileAttachment(ctx, {
      userId,
      storageId: args.storageId,
      filename: args.filename,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
    });

    await ctx.db.patch(args.uploadSessionId, {
      status: "consumed",
      consumedAt: Date.now(),
    });
    return fileAttachmentId;
  },
});

export {
  createKnowledgeBaseUploadUrl,
  bindKnowledgeBaseUploadSession,
  cleanupUnclaimedUpload,
} from "./upload_sessions";

// MARK: - deleteKnowledgeBaseFile

export interface DeleteKnowledgeBaseFileArgs extends Record<string, unknown> {
  storageId: Id<"_storage">;
  fileAttachmentId?: Id<"fileAttachments">;
  source: "upload" | "generated" | "drive";
}

/**
 * Delete a file from the Knowledge Base.
 *
 * For `"generated"` rows: removes the `generatedFiles` row, the parent
 * message's `generatedFileIds` entry, the Drive grant cache (if any), and
 * the storage blob.
 *
 * For `"upload"` and `"drive"` rows (both live in `fileAttachments`): removes
 * the row, the parent message's `attachments` entry (if chat-scoped), the
 * Drive grant cache (if any), and the storage blob.
 */
export async function deleteKnowledgeBaseFileHandler(
  ctx: MutationCtx,
  args: DeleteKnowledgeBaseFileArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  await assertOwnedStorage(ctx, userId, args.storageId);

  if (args.source === "generated") {
    const file = await ctx.db
      .query("generatedFiles")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();

    if (!file) {
      const deleted = await deleteGeneratedMediaKnowledgeBaseFile(
        ctx,
        userId,
        args.storageId,
      );
      if (!deleted) {
        throw new ConvexError({
          code: "NOT_FOUND" as const,
          message: "File not found or not owned by user.",
        });
      }
      return;
    }

    if (file.userId !== userId) {
      throw new ConvexError({
        code: "NOT_FOUND" as const,
        message: "File not found or not owned by user.",
      });
    }

    const message = await ctx.db.get(file.messageId);
    if (message) {
      const updatedIds = (message.generatedFileIds ?? []).filter(
        (id) => id !== file._id,
      );
      await ctx.db.patch(file.messageId, { generatedFileIds: updatedIds });
    }

    await deleteDocumentForDeletedRecord(ctx, userId, {
      storageId: args.storageId,
      generatedFileId: file._id,
    });
    await ctx.db.delete(file._id);
    await deleteDriveGrantCacheForStorage(ctx, userId, args.storageId);
    if (!await storageHasContentReferences(ctx, args.storageId)) {
      await ctx.storage.delete(args.storageId);
    }
    return;
  }

  // source === "upload" | "drive" — both live in `fileAttachments`. The only
  // difference is whether `driveFileId` is set; deletion is identical.
  const fileAtt = args.fileAttachmentId
    ? await ctx.db.get(args.fileAttachmentId)
    : await ctx.db
      .query("fileAttachments")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();

  if (!fileAtt || fileAtt.userId !== userId || fileAtt.storageId !== args.storageId) {
    throw new ConvexError({
      code: "NOT_FOUND" as const,
      message: "Attachment not found or not owned by user.",
    });
  }

  // Remove the attachment from the parent message (if this row was tied to a
  // chat message — Settings-KB-only rows have no messageId).
  if (fileAtt.messageId) {
    const msg = await ctx.db.get(fileAtt.messageId);
    if (msg && "attachments" in msg && Array.isArray(msg.attachments)) {
      const idx = msg.attachments.findIndex(
        (a: { storageId?: string }) => a.storageId === args.storageId,
      );
      if (idx !== -1) {
        const updatedAttachments = [...msg.attachments];
        updatedAttachments.splice(idx, 1);
        await ctx.db.patch(msg._id, { attachments: updatedAttachments });
      }
    }
  }

  const hasOtherRefs = await storageHasOtherFileAttachmentReferences(
    ctx,
    args.storageId,
    fileAtt._id,
  );

  await deleteDocumentForDeletedRecord(ctx, userId, {
    storageId: args.storageId,
    fileAttachmentId: fileAtt._id,
  });
  await ctx.db.delete(fileAtt._id);
  if (!hasOtherRefs) {
    await deleteDriveGrantCacheForStorage(ctx, userId, args.storageId);
    if (!await storageHasContentReferences(ctx, args.storageId)) {
      await ctx.storage.delete(args.storageId);
    }
  }
}

export const deleteKnowledgeBaseFile = mutation({
  args: deleteKnowledgeBaseFileArgs,
  handler: deleteKnowledgeBaseFileHandler,
});

// MARK: - Internal mutations (used by KB Drive import action)

/**
 * Used by `actions.ts:importDriveFileToKnowledgeBase` after `ingestDriveFile`
 * has uploaded the bytes to storage. Splits the action (HTTP work) from the
 * mutation (DB insert) per Convex action/mutation rules.
 */
export { insertDriveImport, updateDriveAttachmentStorage } from "./drive_storage_mutations";
