// convex/knowledge_base/actions.ts
// =============================================================================
// Knowledge Base actions.
//
// `importDriveFileToKnowledgeBase` is the Settings-KB equivalent of the
// chat-flow `attachPickedDriveFiles`. It takes a Drive `fileId`, ingests
// the bytes via the shared `drive_picker/ingest.ts`, and registers a KB-only
// `fileAttachments` row (no chatId/messageId) with `driveFileId` set so the
// KB list shows it as `source: "drive"`.
//
// `refreshDriveStorageIfStale` is the lazy-refresh chokepoint called from
// `convex/scheduledJobs/queries.ts:getKBFileContents` — every read of a
// Drive-sourced KB file checks Drive's `modifiedTime` and re-ingests if
// stale. Per `docs/client-convex-contract.md` the refresh logic lives in
// Convex (not duplicated in tools or per-client code).
// =============================================================================

import { action, internalAction } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { getGoogleAccessToken } from "../tools/google/auth";
import { ingestDriveFile, fetchDriveMetadata } from "../drive_picker/ingest";

/**
 * Import a single Google Drive file into the user's Settings KB.
 *
 * Client flow:
 *   1. Open the Drive Picker (web/iOS/Android), user selects one file.
 *   2. Client calls this action with the Drive `fileId`.
 *   3. Action fetches an access token, ingests the bytes (re-using cached
 *      blob if `modifiedTime` is unchanged), then inserts a KB-only
 *      `fileAttachments` row with `driveFileId` + `lastRefreshedAt` set.
 */
export const importDriveFileToKnowledgeBase = action({
  args: {
    fileId: v.string(),
  },
  returns: v.object({
    fileAttachmentId: v.id("fileAttachments"),
    filename: v.string(),
    storageId: v.id("_storage"),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ fileAttachmentId: Id<"fileAttachments">; filename: string; storageId: Id<"_storage"> }> => {
    const { userId } = await requireAuth(ctx);
    const fileId = args.fileId.trim();
    if (!fileId) {
      throw new ConvexError({ code: "VALIDATION" as const, message: "Drive fileId is required." });
    }

    const { accessToken } = await getGoogleAccessToken(ctx, userId, "drive");
    const cached = await ingestDriveFile(ctx, userId, accessToken, fileId);
    const now = Date.now();

    const fileAttachmentId = await ctx.runMutation(
      internal.knowledge_base.mutations.insertDriveImport,
      {
        userId,
        storageId: cached.storageId,
        filename: cached.name,
        mimeType: cached.mimeType,
        sizeBytes: cached.sizeBytes,
        driveFileId: cached.fileId,
        lastRefreshedAt: now,
      },
    );

    return { fileAttachmentId, filename: cached.name, storageId: cached.storageId };
  },
});

/**
 * Lazy refresh: if the Drive `modifiedTime` for `driveFileId` is newer than
 * `lastRefreshedAt`, re-ingest and return the new `storageId`. Otherwise
 * returns the original `storageId` unchanged.
 *
 * Internal — only called from `convex/scheduledJobs/queries.ts:getKBFileContents`
 * (the single chokepoint where scheduled jobs read KB blob bytes). Chat-attach
 * already refreshes at attach time via `attachPickedDriveFiles`.
 *
 * Returns the (possibly new) storageId so the caller can `ctx.storage.get(id)`
 * with confidence the bytes are current.
 */
export const refreshDriveStorageIfStale = internalAction({
  args: {
    fileAttachmentId: v.id("fileAttachments"),
  },
  returns: v.object({
    storageId: v.id("_storage"),
    refreshed: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ storageId: Id<"_storage">; refreshed: boolean }> => {
    const att = await ctx.runQuery(
      internal.knowledge_base.queries.getFileAttachmentInternal,
      { fileAttachmentId: args.fileAttachmentId },
    );
    if (!att) {
      throw new ConvexError({
        code: "NOT_FOUND" as const,
        message: "File attachment not found.",
      });
    }
    if (!att.driveFileId) {
      // Not a Drive-sourced row — nothing to refresh.
      return { storageId: att.storageId, refreshed: false };
    }

    // Cheap metadata check first — if Drive `modifiedTime` matches what we
    // last cached, skip the download entirely. We deliberately don't catch
    // upstream errors here: Drive-in-KB has never been live for real users,
    // so during dev we want failures to surface loudly rather than silently
    // serving stale cached bytes.
    const { accessToken } = await getGoogleAccessToken(ctx, att.userId, "drive");
    const meta = await fetchDriveMetadata(accessToken, att.driveFileId);

    const grant = await ctx.runQuery(internal.oauth.google.getDriveFileGrantInternal, {
      userId: att.userId,
      fileId: att.driveFileId,
    });
    if (grant?.cachedModifiedTime === meta.modifiedTime) {
      if (grant.cachedStorageId && grant.cachedStorageId !== att.storageId) {
        await ctx.runMutation(internal.knowledge_base.mutations.updateDriveAttachmentStorage, {
          fileAttachmentId: args.fileAttachmentId,
          storageId: grant.cachedStorageId,
          sizeBytes: grant.cachedSizeBytes,
          lastRefreshedAt: Date.now(),
        });
        return { storageId: grant.cachedStorageId, refreshed: true };
      }
      return { storageId: att.storageId, refreshed: false };
    }

    // Stale — re-ingest. `ingestDriveFile` updates the grant cache and
    // (via `recordDriveFileGrantCache`) deletes the prior cached blob.
    const cached = await ingestDriveFile(ctx, att.userId, accessToken, att.driveFileId);
    if (cached.storageId !== att.storageId) {
      await ctx.runMutation(internal.knowledge_base.mutations.updateDriveAttachmentStorage, {
        fileAttachmentId: args.fileAttachmentId,
        storageId: cached.storageId,
        sizeBytes: cached.sizeBytes,
        lastRefreshedAt: Date.now(),
      });
    }
    return { storageId: cached.storageId, refreshed: true };
  },
});
