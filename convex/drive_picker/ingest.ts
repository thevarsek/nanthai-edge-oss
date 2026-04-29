// convex/drive_picker/ingest.ts
// =============================================================================
// Shared Google Drive file ingestion helpers.
//
// Used by:
//   - convex/drive_picker/actions.ts (chat-flow Drive Picker, attaches files
//     to a user message and resumes a paused generation)
//   - convex/knowledge_base/actions.ts (Settings KB Drive import + lazy refresh)
//
// Splits Drive metadata fetch, blob download, and the cache-aware ingest into
// reusable functions so the KB import path doesn't have to duplicate the
// download/dedup logic that already exists for the chat-flow picker.
// =============================================================================

import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const EXPORT_MAP: Record<string, { mimeType: string; extension: string }> = {
  "application/vnd.google-apps.document": { mimeType: "text/plain", extension: "txt" },
  "application/vnd.google-apps.spreadsheet": { mimeType: "text/csv", extension: "csv" },
  "application/vnd.google-apps.presentation": { mimeType: "text/plain", extension: "txt" },
};

export type DriveMetadata = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
};

export type CachedAttachment = {
  fileId: string;
  type: string;
  url: string;
  storageId: Id<"_storage">;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  /** Drive `modifiedTime` of the cached blob — used by KB lazy refresh. */
  modifiedTime: string;
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function driveFileTooLargeError(filename: string, sizeBytes?: number): ConvexError<{
  code: "DRIVE_FILE_TOO_LARGE";
  message: string;
  filename: string;
  maxBytes: number;
  sizeBytes?: number;
}> {
  const maxSize = formatBytes(MAX_TOTAL_ATTACHMENT_BYTES);
  const actualSize = sizeBytes ? ` It is ${formatBytes(sizeBytes)}.` : "";
  return new ConvexError({
    code: "DRIVE_FILE_TOO_LARGE",
    message: `"${filename}" is too large to import. Drive imports are limited to ${maxSize}.${actualSize}`,
    filename,
    maxBytes: MAX_TOTAL_ATTACHMENT_BYTES,
    ...(sizeBytes ? { sizeBytes } : {}),
  });
}

export function attachmentTypeForMime(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "application/pdf") return "pdf";
  return "document";
}

function filenameForExport(name: string, extension?: string): string {
  if (!extension) return name;
  return name.toLowerCase().endsWith(`.${extension}`) ? name : `${name}.${extension}`;
}

export async function fetchDriveMetadata(
  accessToken: string,
  fileId: string,
): Promise<DriveMetadata> {
  const response = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,size,webViewLink`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new ConvexError({
      code: "UPSTREAM_ERROR",
      message: `Failed to read Drive file metadata (${response.status}).`,
    });
  }
  return (await response.json()) as DriveMetadata;
}

export async function downloadDriveFileBytes(
  accessToken: string,
  meta: DriveMetadata,
): Promise<{ bytes: ArrayBuffer; mimeType: string; filename: string }> {
  const exportInfo = EXPORT_MAP[meta.mimeType];
  const url = exportInfo
    ? `${DRIVE_API}/files/${encodeURIComponent(meta.id)}/export?mimeType=${encodeURIComponent(exportInfo.mimeType)}`
    : `${DRIVE_API}/files/${encodeURIComponent(meta.id)}?alt=media`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new ConvexError({
      code: "UPSTREAM_ERROR",
      message: `Failed to download Drive file "${meta.name}" (${response.status}).`,
    });
  }
  const mimeType = exportInfo?.mimeType ?? meta.mimeType;
  return {
    bytes: await response.arrayBuffer(),
    mimeType,
    filename: filenameForExport(meta.name, exportInfo?.extension),
  };
}

/**
 * Fetch a Drive file and ensure it's cached in Convex storage.
 *
 * - If the cached blob's `modifiedTime` matches Drive, returns the cached
 *   storageId without re-downloading.
 * - Otherwise downloads, stores, and updates the `googleDriveFileGrants`
 *   cache row (the previous blob is deleted by `recordDriveFileGrantCache`).
 *
 * Returns a `CachedAttachment` with the latest `storageId` and `modifiedTime`.
 */
export async function ingestDriveFile(
  ctx: ActionCtx,
  userId: string,
  accessToken: string,
  fileId: string,
): Promise<CachedAttachment> {
  const meta = await fetchDriveMetadata(accessToken, fileId);
  await ctx.runMutation(internal.oauth.google.recordDriveFileGrant, {
    userId,
    fileId: meta.id,
    name: meta.name,
    mimeType: meta.mimeType,
    webViewLink: meta.webViewLink,
    size: meta.size,
  });
  const declaredSize = meta.size ? Number(meta.size) : undefined;
  if (declaredSize && declaredSize > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw driveFileTooLargeError(meta.name, declaredSize);
  }

  const existing = await ctx.runQuery(internal.oauth.google.getDriveFileGrantInternal, {
    userId,
    fileId: meta.id,
  });

  if (
    existing?.cachedStorageId &&
    existing.cachedModifiedTime === meta.modifiedTime
  ) {
    const url = await ctx.storage.getUrl(existing.cachedStorageId);
    if (url) {
      return {
        fileId: meta.id,
        type: attachmentTypeForMime(existing.mimeType),
        url,
        storageId: existing.cachedStorageId,
        name: existing.name,
        mimeType: existing.mimeType,
        sizeBytes: existing.cachedSizeBytes,
        modifiedTime: existing.cachedModifiedTime,
      };
    }
  }

  const downloaded = await downloadDriveFileBytes(accessToken, meta);
  if (downloaded.bytes.byteLength > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw driveFileTooLargeError(downloaded.filename, downloaded.bytes.byteLength);
  }

  const storageId = (await ctx.storage.store(
    new Blob([downloaded.bytes], { type: downloaded.mimeType }),
  )) as Id<"_storage">;
  const url = await ctx.storage.getUrl(storageId);
  if (!url) {
    throw new ConvexError({ code: "INTERNAL_ERROR", message: "Failed to create Drive attachment URL." });
  }

  await ctx.runMutation(internal.oauth.google.recordDriveFileGrantCache, {
    userId,
    fileId: meta.id,
    name: downloaded.filename,
    mimeType: downloaded.mimeType,
    webViewLink: meta.webViewLink,
    size: meta.size,
    cachedStorageId: storageId,
    cachedModifiedTime: meta.modifiedTime,
    cachedSizeBytes: downloaded.bytes.byteLength,
  });

  return {
    fileId: meta.id,
    type: attachmentTypeForMime(downloaded.mimeType),
    url,
    storageId,
    name: downloaded.filename,
    mimeType: downloaded.mimeType,
    sizeBytes: downloaded.bytes.byteLength,
    modifiedTime: meta.modifiedTime,
  };
}
