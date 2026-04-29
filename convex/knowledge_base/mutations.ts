// convex/knowledge_base/mutations.ts
// =============================================================================
// Knowledge Base mutations.
//
// Owns all Settings-KB write paths plus the unified delete that handles
// generated/upload/drive sources. Drive import is split into action+mutation
// (see `actions.ts`) so the HTTP fetch lives in the action.
//
// Per `docs/client-convex-contract.md`, web/iOS/Android all call the same
// mutations here for KB writes — no parallel client-specific paths.
// =============================================================================

import { internalMutation, mutation, MutationCtx } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import {
  insertFileAttachment,
  deleteDriveGrantCacheForStorage,
  storageHasOtherFileAttachmentReferences,
} from "../lib/file_attachments";
import type { ScheduledJobStepConfig } from "../scheduledJobs/shared";
import {
  addUploadToKnowledgeBaseArgs,
  deleteKnowledgeBaseFileArgs,
} from "./mutations_args";

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

export const createKnowledgeBaseUploadUrl = mutation({
  args: {},
  returns: v.object({
    uploadUrl: v.string(),
    uploadSessionId: v.id("kbUploadSessions"),
  }),
  handler: async (ctx): Promise<{ uploadUrl: string; uploadSessionId: Id<"kbUploadSessions"> }> => {
    const { userId } = await requireAuth(ctx);
    const uploadUrl = await ctx.storage.generateUploadUrl();
    const uploadSessionId = await ctx.db.insert("kbUploadSessions", {
      userId,
      status: "pending",
      createdAt: Date.now(),
    });
    return { uploadUrl, uploadSessionId };
  },
});

export const bindKnowledgeBaseUploadSession = mutation({
  args: {
    uploadSessionId: v.id("kbUploadSessions"),
    storageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { userId } = await requireAuth(ctx);
    const session = await ctx.db.get(args.uploadSessionId);
    if (!session || session.userId !== userId || session.status !== "pending") {
      throw new ConvexError({
        code: "FORBIDDEN" as const,
        message: "Upload session is missing or already used.",
      });
    }
    await ctx.db.patch(args.uploadSessionId, { storageId: args.storageId });
    return null;
  },
});

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

  if (args.source === "generated") {
    const file = await ctx.db
      .query("generatedFiles")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();

    if (!file) {
      const media = await ctx.db
        .query("generatedMedia")
        .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
        .first();

      if (!media || media.userId !== userId) {
        throw new ConvexError({
          code: "NOT_FOUND" as const,
          message: "File not found or not owned by user.",
        });
      }

      await ctx.db.delete(media._id);
      await deleteDriveGrantCacheForStorage(ctx, userId, args.storageId);
      await ctx.storage.delete(args.storageId);
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

    await ctx.db.delete(file._id);
    await deleteDriveGrantCacheForStorage(ctx, userId, args.storageId);
    await ctx.storage.delete(args.storageId);
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
    userId,
    args.storageId,
    fileAtt._id,
  );

  await ctx.db.delete(fileAtt._id);
  if (!hasOtherRefs) {
    await deleteDriveGrantCacheForStorage(ctx, userId, args.storageId);
    await ctx.storage.delete(args.storageId);
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
export const insertDriveImport = internalMutation({
  args: {
    userId: v.string(),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
    driveFileId: v.string(),
    lastRefreshedAt: v.number(),
  },
  returns: v.id("fileAttachments"),
  handler: async (ctx, args): Promise<Id<"fileAttachments">> => {
    return await insertFileAttachment(ctx, {
      userId: args.userId,
      storageId: args.storageId,
      filename: args.filename,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      driveFileId: args.driveFileId,
      lastRefreshedAt: args.lastRefreshedAt,
    });
  },
});

/**
 * Used by `actions.ts:refreshDriveStorageIfStale` after re-ingesting a stale
 * Drive file. Updates the row to point at the new storage blob and bumps
 * `lastRefreshedAt`. Old blobs are immutable snapshots and are cleaned up when
 * the row that still references them is deleted.
 */
export const updateDriveAttachmentStorage = internalMutation({
  args: {
    fileAttachmentId: v.id("fileAttachments"),
    storageId: v.id("_storage"),
    sizeBytes: v.optional(v.number()),
    lastRefreshedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const att = await ctx.db.get(args.fileAttachmentId);
    if (!att) return null;

    const previousStorageId = att.storageId;
    await ctx.db.patch(args.fileAttachmentId, {
      storageId: args.storageId,
      sizeBytes: args.sizeBytes,
      lastRefreshedAt: args.lastRefreshedAt,
    });

    const jobs = await ctx.db
      .query("scheduledJobs")
      .withIndex("by_user", (q) => q.eq("userId", att.userId))
      .collect();
    for (const job of jobs) {
      let changed = false;
      const replacement = (id: Id<"_storage">) => {
        if (id === previousStorageId) {
          changed = true;
          return args.storageId;
        }
        return id;
      };
      const nextKnowledgeBaseFileIds = job.knowledgeBaseFileIds?.map(replacement);
      const nextSteps: ScheduledJobStepConfig[] | undefined = job.steps?.map((step) => ({
        ...step,
        knowledgeBaseFileIds: step.knowledgeBaseFileIds?.map(replacement),
      }));

      if (changed) {
        await ctx.db.patch(job._id, {
          knowledgeBaseFileIds: nextKnowledgeBaseFileIds,
          steps: nextSteps,
          updatedAt: Date.now(),
        });
      }
    }
    return null;
  },
});
