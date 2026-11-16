import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { insertFileAttachment } from "../lib/file_attachments";
import type { ScheduledJobStepConfig } from "../scheduledJobs/shared";

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
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
    externalModifiedTime: v.optional(v.string()),
    lastRefreshedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const att = await ctx.db.get(args.fileAttachmentId);
    if (!att) return null;

    const previousStorageId = att.storageId;
    await ctx.db.patch(args.fileAttachmentId, {
      storageId: args.storageId,
      filename: args.filename,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      lastRefreshedAt: args.lastRefreshedAt,
    });

    const document = await ctx.db
      .query("documents")
      .withIndex("by_file_attachment", (q) => q.eq("fileAttachmentId", args.fileAttachmentId))
      .first();
    if (document && document.userId === att.userId) {
      const versions = await ctx.db
        .query("documentVersions")
        .withIndex("by_document", (q) => q.eq("documentId", document._id))
        .collect();
      const nextVersionNumber = versions.reduce(
        (max, version) => Math.max(max, version.versionNumber),
        0,
      ) + 1;
      const currentVersion = document.currentVersionId
        ? await ctx.db.get(document.currentVersionId)
        : null;
      const newVersionId = await ctx.db.insert("documentVersions", {
        documentId: document._id,
        userId: document.userId,
        storageId: args.storageId,
        filename: args.filename,
        mimeType: args.mimeType,
        versionNumber: nextVersionNumber,
        source: "drive_refresh" as const,
        parentVersionId: document.currentVersionId,
        extractionStatus: "pending" as const,
        externalModifiedTime: args.externalModifiedTime,
        createdAt: Date.now(),
      });
      const canAdvanceCurrent =
        !currentVersion ||
        currentVersion.source === "drive_import" ||
        currentVersion.source === "drive_refresh";
      await ctx.db.patch(document._id, {
        currentVersionId: canAdvanceCurrent ? newVersionId : document.currentVersionId,
        externalSyncedVersionId: newVersionId,
        filename: args.filename,
        mimeType: args.mimeType,
        externalModifiedTime: args.externalModifiedTime,
        syncState: canAdvanceCurrent ? "updated_from_drive" : "external_update_available",
        sourceStorageId: args.storageId,
        updatedAt: Date.now(),
      });
    }

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
