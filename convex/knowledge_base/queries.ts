// convex/knowledge_base/queries.ts
// =============================================================================
// Knowledge Base queries — public + internal.
//
// Owns the unified KB listing across three storage backends:
//   - generatedFiles  (AI tool output)
//   - generatedMedia  (image/video generation, M29)
//   - fileAttachments (uploads + Drive imports)
//
// Drive vs upload is derived from `fileAttachments.driveFileId` presence; we
// never write `source` to disk. See `docs/client-convex-contract.md` — all
// clients render KB from this single response shape.
// =============================================================================

import { internalQuery, query, QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { optionalAuth } from "../lib/auth";
import { isReadableDocumentMime } from "../documents/shared";
import {
  listKnowledgeBaseFilesArgs,
  getKnowledgeBaseFilesByStorageIdsArgs,
} from "./queries_args";

/** Unified shape returned from the KB listing query. */
export interface KBFileRecord {
  storageId: string;
  fileAttachmentId?: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  /**
   * Where this KB entry came from:
   * - `upload`: user-uploaded file (chat or Settings KB)
   * - `generated`: AI-produced file/media
   * - `drive`: imported from Google Drive (M24 Phase 6)
   */
  source: "upload" | "generated" | "drive";
  toolName?: string;
  /** Set only for `upload` rows that originated inside a chat message. */
  chatId?: string;
  /** Set only for `upload` rows that originated inside a chat message. */
  messageId?: string;
  /** Set only for `drive` rows. The Google Drive `fileId`. */
  driveFileId?: string;
  /**
   * Set only for `drive` rows. Last time we re-checked Drive's
   * `modifiedTime` and (if changed) re-downloaded the blob.
   * Used by clients to surface "synced X ago" hints.
   */
  lastRefreshedAt?: number;
  documentId?: string;
  documentVersionId?: string;
  documentStatus?: "ready" | "extracting" | "error";
  documentExtractionStatus?: string;
  documentVersionNumber?: number;
  documentSyncState?: string;
  documentExternalSyncedVersionId?: string;
  documentExternalSyncedVersionNumber?: number;
  documentExternalSyncedDownloadUrl?: string | null;
  documentFolderId?: string;
  isReadableDocument?: boolean;
  createdAt: number;
  downloadUrl: string | null;
}

export interface ListKnowledgeBaseFilesArgs extends Record<string, unknown> {
  search?: string;
  source?: "upload" | "generated" | "drive" | "all";
  folderId?: Id<"folders">;
  folderFilter?: "all" | "unfiled";
  limit?: number;
}

export interface GetKnowledgeBaseFilesByStorageIdsArgs extends Record<string, unknown> {
  storageIds: Id<"_storage">[];
}

/**
 * List all files belonging to the authenticated user.
 *
 * Merges generatedFiles, generatedMedia, and fileAttachments into a unified
 * `KBFileRecord[]` sorted by createdAt desc. Drive-sourced rows are
 * `fileAttachments` rows with `driveFileId` set.
 */
export async function listKnowledgeBaseFilesHandler(
  ctx: QueryCtx,
  args: ListKnowledgeBaseFilesArgs,
): Promise<KBFileRecord[]> {
  const auth = await optionalAuth(ctx);
  if (!auth) return [];

  const limit = Math.min(Math.max(Math.floor(args.limit ?? 100), 1), 500);
  const sourceFilter = args.source ?? "all";
  const searchLower = args.search?.toLowerCase().trim();
  const folderFilter = args.folderFilter ?? "all";
  const isFolderScoped = !!args.folderId || folderFilter === "unfiled";

  // Server-side fetch cap across all sources to bound memory. Set higher than
  // the requested limit to allow for dedup and text-search filtering, then
  // divide across active sources so total loaded records stay bounded.
  // Drive rows live inside `fileAttachments` alongside uploads, so they
  // share the same fetch — no extra source slot needed.
  const sourceCount =
    sourceFilter === "all" ? 3 : sourceFilter === "generated" ? 2 : 1;
  const totalFetchCap = isFolderScoped ? 5000 : Math.min(Math.max(limit * 5, 200), 1000);
  const fetchCap = Math.ceil(totalFetchCap / sourceCount);

  const results: KBFileRecord[] = [];

  if (args.folderId) {
    const folderChats = await ctx.db
      .query("chats")
      .withIndex("by_user_folder", (q) =>
        q.eq("userId", auth.userId).eq("folderId", args.folderId as string),
      )
      .order("desc")
      .take(500);

    for (const chat of folderChats) {
      if (sourceFilter === "all" || sourceFilter === "generated") {
        const generated = await ctx.db
          .query("generatedFiles")
          .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
          .take(200);
        for (const f of generated) {
          if (f.userId !== auth.userId) continue;
          if (searchLower && !f.filename.toLowerCase().includes(searchLower)) continue;
          results.push({
            storageId: f.storageId,
            filename: f.filename,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            source: "generated",
            toolName: f.toolName,
            chatId: f.chatId,
            messageId: f.messageId,
            createdAt: f.createdAt,
            downloadUrl: null,
          });
        }

        const media = await ctx.db
          .query("generatedMedia")
          .withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
          .take(200);
        for (const m of media) {
          if (m.userId !== auth.userId) continue;
          const filename = m.type === "video" ? "generated-video.mp4" : "generated-image.png";
          if (searchLower && !filename.toLowerCase().includes(searchLower)) continue;
          results.push({
            storageId: m.storageId,
            filename,
            mimeType: m.mimeType,
            sizeBytes: m.sizeBytes,
            source: "generated",
            toolName: m.type === "video" ? "video_generation" : "image_generation",
            chatId: m.chatId,
            messageId: m.messageId,
            createdAt: m.createdAt,
            downloadUrl: null,
          });
        }
      }

      const wantUpload = sourceFilter === "all" || sourceFilter === "upload";
      const wantDrive = sourceFilter === "all" || sourceFilter === "drive";
      if (wantUpload || wantDrive) {
        const uploads = await ctx.db
          .query("fileAttachments")
          .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
          .take(200);
        for (const att of uploads) {
          if (att.userId !== auth.userId) continue;
          const isDrive = !!att.driveFileId;
          if (isDrive && !wantDrive) continue;
          if (!isDrive && !wantUpload) continue;
          const filename = att.filename ?? "attachment";
          if (searchLower && !filename.toLowerCase().includes(searchLower)) continue;
          results.push({
            storageId: att.storageId,
            fileAttachmentId: att._id,
            filename,
            mimeType: att.mimeType,
            sizeBytes: att.sizeBytes,
            source: isDrive ? "drive" : "upload",
            chatId: att.chatId,
            messageId: att.messageId,
            driveFileId: att.driveFileId,
            lastRefreshedAt: att.lastRefreshedAt,
            createdAt: att.createdAt,
            downloadUrl: null,
          });
        }
      }
    }

    // Canonical documents in this folder are hydrated below via their source
    // storage/file rows. Chat-origin rows are collected from the folder's chats;
    // future document-only rows should add a dedicated source-table branch.
  }

  // 1. Collect AI-generated files (if source allows)
  if (!args.folderId && (sourceFilter === "all" || sourceFilter === "generated")) {
    const generated = await ctx.db
      .query("generatedFiles")
      .withIndex("by_user", (q) => q.eq("userId", auth.userId))
      .order("desc")
      .take(fetchCap);

    for (const f of generated) {
      if (searchLower && !f.filename.toLowerCase().includes(searchLower)) {
        continue;
      }
      results.push({
        storageId: f.storageId,
        filename: f.filename,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        source: "generated",
        toolName: f.toolName,
        chatId: f.chatId,
        messageId: f.messageId,
        createdAt: f.createdAt,
        downloadUrl: null, // resolved below
      });
    }

    // 1b. M29: Collect generated media (images & videos) from generatedMedia table.
    const media = await ctx.db
      .query("generatedMedia")
      .withIndex("by_userId", (q) => q.eq("userId", auth.userId))
      .order("desc")
      .take(fetchCap);

    for (const m of media) {
      const filename = m.type === "video" ? "generated-video.mp4" : "generated-image.png";
      if (searchLower && !filename.toLowerCase().includes(searchLower)) {
        continue;
      }
      results.push({
        storageId: m.storageId,
        filename,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        source: "generated",
        toolName: m.type === "video" ? "video_generation" : "image_generation",
        chatId: m.chatId,
        messageId: m.messageId,
        createdAt: m.createdAt,
        downloadUrl: null,
      });
    }
  }

  // 2. Collect user-uploaded attachments + drive imports from the
  //    `fileAttachments` table. Drive imports are distinguished by the
  //    presence of `driveFileId`. We pull both whenever either filter is
  //    active so we don't need duplicate index scans.
  const wantUpload = sourceFilter === "all" || sourceFilter === "upload";
  const wantDrive = sourceFilter === "all" || sourceFilter === "drive";
  if (!args.folderId && (wantUpload || wantDrive)) {
    const uploads = await ctx.db
      .query("fileAttachments")
      .withIndex("by_user", (q) => q.eq("userId", auth.userId))
      .order("desc")
      .take(fetchCap);

    for (const att of uploads) {
      const isDrive = !!att.driveFileId;
      if (isDrive && !wantDrive) continue;
      if (!isDrive && !wantUpload) continue;

      const filename = att.filename ?? "attachment";
      if (searchLower && !filename.toLowerCase().includes(searchLower)) {
        continue;
      }
      results.push({
        storageId: att.storageId,
        fileAttachmentId: att._id,
        filename,
        mimeType: att.mimeType,
        sizeBytes: att.sizeBytes,
        source: isDrive ? "drive" : "upload",
        chatId: att.chatId,
        messageId: att.messageId,
        driveFileId: att.driveFileId,
        lastRefreshedAt: att.lastRefreshedAt,
        createdAt: att.createdAt,
        downloadUrl: null, // resolved below
      });
    }
  }

  // 3. Hydrate canonical document metadata and derive folder filtering.
  const withDocumentMetadata: KBFileRecord[] = [];
  const canHydrateDocuments = typeof ctx.db.get === "function";
  for (const result of results) {
    const document =
      canHydrateDocuments
        ? result.fileAttachmentId
          ? await ctx.db
            .query("documents")
            .withIndex("by_file_attachment", (q) =>
              q.eq("fileAttachmentId", result.fileAttachmentId as Id<"fileAttachments">),
            )
            .first()
          : result.source === "generated"
            ? await ctx.db
              .query("documents")
              .withIndex("by_source_storage", (q) => q.eq("sourceStorageId", result.storageId as Id<"_storage">))
              .first()
            : await ctx.db
              .query("documents")
              .withIndex("by_source_storage", (q) => q.eq("sourceStorageId", result.storageId as Id<"_storage">))
              .first()
        : null;

    let version = null;
    if (document?.currentVersionId) {
      version = await ctx.db.get(document.currentVersionId);
    }
    const externalSyncedVersion = document?.externalSyncedVersionId
      ? await ctx.db.get(document.externalSyncedVersionId)
      : null;

    let derivedFolderId = document?.folderId as string | undefined;
    if (canHydrateDocuments && !derivedFolderId && result.chatId) {
      const chat = await ctx.db.get(result.chatId as Id<"chats">);
      if (chat?.userId === auth.userId) {
        derivedFolderId = chat.folderId;
      }
    }

    if (args.folderId && derivedFolderId !== args.folderId) {
      continue;
    }
    if (folderFilter === "unfiled" && derivedFolderId) {
      continue;
    }

    withDocumentMetadata.push({
      ...result,
      documentId: document?._id,
      documentVersionId: document?.currentVersionId,
      documentStatus: document?.status,
      documentExtractionStatus: version?.extractionStatus,
      documentVersionNumber: version?.versionNumber,
      documentSyncState: document?.syncState,
      documentExternalSyncedVersionId: document?.externalSyncedVersionId,
      documentExternalSyncedVersionNumber: externalSyncedVersion?.versionNumber,
      documentExternalSyncedDownloadUrl: externalSyncedVersion
        ? await ctx.storage.getUrl(externalSyncedVersion.storageId)
        : undefined,
      documentFolderId: derivedFolderId,
      isReadableDocument: isReadableDocumentMime(result.mimeType, result.filename),
    });
  }

  // 4. Deduplicate by storageId (same file referenced multiple times)
  const seen = new Set<string>();
  const deduped = withDocumentMetadata.filter((r) => {
    if (seen.has(r.storageId)) return false;
    seen.add(r.storageId);
    return true;
  });

  // 5. Sort by createdAt desc, take limit
  deduped.sort((a, b) => b.createdAt - a.createdAt);
  const page = deduped.slice(0, limit);

  // 6. Resolve download URLs
  return Promise.all(
    page.map(async (r) => ({
      ...r,
      downloadUrl: await ctx.storage.getUrl(r.storageId as Id<"_storage">),
    })),
  );
}

export async function getKnowledgeBaseFilesByStorageIdsHandler(
  ctx: QueryCtx,
  args: GetKnowledgeBaseFilesByStorageIdsArgs,
): Promise<KBFileRecord[]> {
  const auth = await optionalAuth(ctx);
  if (!auth || args.storageIds.length === 0) return [];

  const wanted = new Set(args.storageIds.map((id) => id as string));
  const results: KBFileRecord[] = [];
  const seen = new Set<string>();

  for (const storageId of args.storageIds) {
    const generated = await ctx.db
      .query("generatedFiles")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first();
    if (generated?.userId === auth.userId && !seen.has(generated.storageId)) {
      seen.add(generated.storageId);
      results.push({
        storageId: generated.storageId,
        filename: generated.filename,
        mimeType: generated.mimeType,
        sizeBytes: generated.sizeBytes,
        source: "generated",
        toolName: generated.toolName,
        chatId: generated.chatId,
        messageId: generated.messageId,
        createdAt: generated.createdAt,
        downloadUrl: await ctx.storage.getUrl(generated.storageId),
      });
      continue;
    }

    const media = await ctx.db
      .query("generatedMedia")
      .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
      .first();
    if (media?.userId === auth.userId && !seen.has(media.storageId)) {
      seen.add(media.storageId);
      const filename = media.type === "video" ? "generated-video.mp4" : "generated-image.png";
      results.push({
        storageId: media.storageId,
        filename,
        mimeType: media.mimeType,
        sizeBytes: media.sizeBytes,
        source: "generated",
        toolName: media.type === "video" ? "video_generation" : "image_generation",
        chatId: media.chatId,
        messageId: media.messageId,
        createdAt: media.createdAt,
        downloadUrl: await ctx.storage.getUrl(media.storageId),
      });
      continue;
    }

    const att = await ctx.db
      .query("fileAttachments")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first();
    if (att?.userId === auth.userId && !seen.has(att.storageId)) {
      seen.add(att.storageId);
      const isDrive = !!att.driveFileId;
      results.push({
        storageId: att.storageId,
        fileAttachmentId: att._id,
        filename: att.filename ?? "attachment",
        mimeType: att.mimeType,
        sizeBytes: att.sizeBytes,
        source: isDrive ? "drive" : "upload",
        chatId: att.chatId,
        messageId: att.messageId,
        driveFileId: att.driveFileId,
        lastRefreshedAt: att.lastRefreshedAt,
        createdAt: att.createdAt,
        downloadUrl: await ctx.storage.getUrl(att.storageId),
      });
    }
  }

  return results.filter((file) => wanted.has(file.storageId));
}

// MARK: - Public wrappers

export const listKnowledgeBaseFiles = query({
  args: listKnowledgeBaseFilesArgs,
  handler: listKnowledgeBaseFilesHandler,
});

export const getKnowledgeBaseFilesByStorageIds = query({
  args: getKnowledgeBaseFilesByStorageIdsArgs,
  handler: getKnowledgeBaseFilesByStorageIdsHandler,
});

// MARK: - Internal queries (used by the lazy-refresh chokepoint)

export const getFileAttachmentInternal = internalQuery({
  args: {
    fileAttachmentId: v.id("fileAttachments"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    _id: Id<"fileAttachments">;
    userId: string;
    storageId: Id<"_storage">;
    filename: string;
    mimeType: string;
    sizeBytes?: number;
    driveFileId?: string;
    lastRefreshedAt?: number;
  } | null> => {
    const att = await ctx.db.get(args.fileAttachmentId);
    if (!att) return null;
    return {
      _id: att._id,
      userId: att.userId,
      storageId: att.storageId,
      filename: att.filename,
      mimeType: att.mimeType,
      sizeBytes: att.sizeBytes,
      driveFileId: att.driveFileId,
      lastRefreshedAt: att.lastRefreshedAt,
    };
  },
});

/**
 * Resolve a `_storage` id back to its owning `fileAttachments` row, if any.
 * Returns `null` for storage ids that aren't tracked in `fileAttachments`
 * (e.g. AI-generated rows live in `generatedFiles`/`generatedMedia`, which
 * never need Drive refresh).
 *
 * Used by `scheduledJobs.queries.getKBFileContents` to decide whether to
 * route a storage id through the Drive lazy-refresh chokepoint.
 */
export const getFileAttachmentByStorageInternal = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    _id: Id<"fileAttachments">;
    driveFileId?: string;
  } | null> => {
    const att = await ctx.db
      .query("fileAttachments")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();
    if (!att) return null;
    return { _id: att._id, driveFileId: att.driveFileId };
  },
});
