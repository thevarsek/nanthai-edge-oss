// convex/lib/file_attachments.ts
// =============================================================================
// Shared helpers for the `fileAttachments` denormalized lookup table.
//
// `fileAttachments` rows back four distinct flows:
//   1. User-uploaded chat attachments         (chatId + messageId set)
//   2. Drive Picker attachments inside a chat (chatId + messageId + driveFileId set)
//   3. Settings KB uploads                    (no chatId/messageId)
//   4. Settings KB Drive imports              (no chatId/messageId, driveFileId set)
//
// Centralising the insert + the Drive grant cache deletion keeps schema drift
// from leaking across `convex/chat/`, `convex/drive_picker/`, and the new
// `convex/knowledge_base/` modules. See `docs/client-convex-contract.md` —
// shared business logic must live in Convex, not duplicated per call site.
// =============================================================================

import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

export interface InsertFileAttachmentArgs {
  userId: string;
  storageId: Id<"_storage">;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  /** Set for chat-attached rows only. */
  chatId?: Id<"chats">;
  /** Set for chat-attached rows only. */
  messageId?: Id<"messages">;
  /** Set for Drive-sourced rows (chat picker + KB import). */
  driveFileId?: string;
  /** Set for Drive-sourced rows. Drive `modifiedTime` at last refresh. */
  lastRefreshedAt?: number;
  /** Defaults to `Date.now()`. */
  createdAt?: number;
}

/**
 * Insert a `fileAttachments` row.
 *
 * Single chokepoint so adding a new column (e.g., `driveFileId` in M24
 * Phase 6) is a one-line schema change instead of touching four call sites.
 *
 * Returns the new row's `_id`.
 */
export async function insertFileAttachment(
  ctx: MutationCtx,
  args: InsertFileAttachmentArgs,
): Promise<Id<"fileAttachments">> {
  return await ctx.db.insert("fileAttachments", {
    userId: args.userId,
    chatId: args.chatId,
    messageId: args.messageId,
    storageId: args.storageId,
    filename: args.filename,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
    driveFileId: args.driveFileId,
    lastRefreshedAt: args.lastRefreshedAt,
    createdAt: args.createdAt ?? Date.now(),
  });
}

/**
 * Delete every `googleDriveFileGrants` cache row that points at `storageId`.
 *
 * Called from:
 *   - `deleteKnowledgeBaseFileHandler` when a user removes a KB file
 *   - chat deletion (`manage_delete_helpers.ts:cascadeDeleteChat`) when a
 *     chat with Drive attachments is deleted
 *
 * Without this hook we'd leave orphan Drive grant cache rows pointing at
 * already-deleted storage blobs, breaking the next "is this file still
 * cached?" check in `ingestDriveFile`.
 */
export async function deleteDriveGrantCacheForStorage(
  ctx: MutationCtx,
  userId: string,
  storageId: Id<"_storage">,
): Promise<void> {
  const grants = await ctx.db
    .query("googleDriveFileGrants")
    .withIndex("by_user_cached_storage", (q) =>
      q.eq("userId", userId).eq("cachedStorageId", storageId),
    )
    .collect();

  for (const grant of grants) {
    await ctx.db.delete(grant._id);
  }
}

export async function storageHasOtherFileAttachmentReferences(
  ctx: MutationCtx,
  userId: string,
  storageId: Id<"_storage">,
  excludingFileAttachmentId?: Id<"fileAttachments">,
): Promise<boolean> {
  const refs = await ctx.db
    .query("fileAttachments")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .collect();

  return refs.some(
    (ref) => ref.userId === userId && ref._id !== excludingFileAttachmentId,
  );
}
