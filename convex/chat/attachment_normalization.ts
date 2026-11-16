// convex/chat/attachment_normalization.ts
// =============================================================================
// Validates the attachments a client sends with a chat turn or research paper.
//
// An attachment is either a storage blob the caller owns (a pending chat upload
// session, or an existing Knowledge Base attachment row) or an inline `data:`
// URL. Remote URLs are rejected: the backend would otherwise fetch an
// arbitrary host outside the egress gateway.
// =============================================================================

import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type RawAttachment = {
  type: string;
  url?: string;
  storageId?: Id<"_storage">;
  uploadSessionId?: Id<"chatUploadSessions">;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  driveFileId?: string;
  lastRefreshedAt?: number;
  videoRole?: "first_frame" | "last_frame" | "reference";
};

export type NormalizedAttachment = {
  type: string;
  url: string;
  storageId?: Id<"_storage">;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  driveFileId?: string;
  lastRefreshedAt?: number;
  videoRole?: "first_frame" | "last_frame" | "reference";
};

function looksLikeBase64(value: string): boolean {
  if (!value) return false;
  const encoded = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const compact = encoded.replace(/\s+/g, "");
  return compact.length >= 64 && /^[A-Za-z0-9+/=]+$/.test(compact);
}

function estimatedBase64Size(value: string): number {
  const encoded = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  return Math.floor((encoded.replace(/\s+/g, "").length * 3) / 4);
}

const uploadFailed = () =>
  new ConvexError({ code: "VALIDATION", message: "Attachment upload failed. Please retry." });
const notOwned = () =>
  new ConvexError({ code: "FORBIDDEN", message: "Attachment upload is missing or not owned by user." });

async function assertAttachmentStorageOwned(
  ctx: MutationCtx,
  userId: string,
  attachment: RawAttachment & { storageId: Id<"_storage"> },
  consumedSessionIds: Set<Id<"chatUploadSessions">>,
): Promise<void> {
  if (attachment.uploadSessionId) {
    const session = await ctx.db.get(attachment.uploadSessionId);
    if (
      !session ||
      session.userId !== userId ||
      session.status !== "pending" ||
      session.storageId !== attachment.storageId
    ) {
      throw notOwned();
    }
    if (!consumedSessionIds.has(attachment.uploadSessionId)) {
      consumedSessionIds.add(attachment.uploadSessionId);
      await ctx.db.patch(attachment.uploadSessionId, { status: "consumed", consumedAt: Date.now() });
    }
    return;
  }
  const existingAttachment = await ctx.db
    .query("fileAttachments")
    .withIndex("by_storage", (q) => q.eq("storageId", attachment.storageId))
    .take(20);
  if (!existingAttachment.some((row) => row.userId === userId)) throw notOwned();
}

async function normalizeOne(
  ctx: MutationCtx,
  userId: string,
  attachment: RawAttachment,
  consumedSessionIds: Set<Id<"chatUploadSessions">>,
): Promise<NormalizedAttachment> {
  if (attachment.uploadSessionId && !attachment.storageId) {
    throw new ConvexError({ code: "VALIDATION", message: "Upload session must reference a stored attachment." });
  }

  let resolvedUrl: string | undefined;
  let sizeBytes: number;
  let mimeType = attachment.mimeType;
  if (attachment.storageId) {
    const storageMetadata = await ctx.storage.getMetadata(attachment.storageId);
    if (!storageMetadata) throw uploadFailed();
    await assertAttachmentStorageOwned(
      ctx, userId, { ...attachment, storageId: attachment.storageId }, consumedSessionIds,
    );
    resolvedUrl = await ctx.storage.getUrl(attachment.storageId) ?? undefined;
    sizeBytes = storageMetadata.size;
    mimeType = storageMetadata.contentType ?? attachment.mimeType;
  } else {
    resolvedUrl = attachment.url?.trim();
    if (resolvedUrl && !resolvedUrl.startsWith("data:")) {
      throw new ConvexError({
        code: "VALIDATION",
        message: "Attachments must be uploaded files. Remote links are not supported.",
      });
    }
    // Inline data counts at its decoded size, whatever size the client reports.
    sizeBytes = Math.max(
      attachment.sizeBytes ?? 0,
      resolvedUrl && looksLikeBase64(resolvedUrl) ? estimatedBase64Size(resolvedUrl) : 0,
    );
  }
  if (!resolvedUrl) throw uploadFailed();
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new ConvexError({ code: "VALIDATION", message: "Attachment size is invalid." });
  }

  return {
    type: attachment.type === "pdf" ? "document" : attachment.type,
    url: resolvedUrl,
    storageId: attachment.storageId,
    name: attachment.name && attachment.name.trim().length > 0 ? attachment.name : "attachment",
    mimeType,
    sizeBytes,
    driveFileId: attachment.driveFileId,
    lastRefreshedAt: attachment.lastRefreshedAt,
    videoRole: attachment.videoRole,
  };
}

export async function normalizeMessageAttachments(
  ctx: MutationCtx,
  userId: string,
  attachments: RawAttachment[] | undefined,
): Promise<NormalizedAttachment[] | undefined> {
  if (!attachments) return undefined;
  const consumedSessionIds = new Set<Id<"chatUploadSessions">>();
  const normalized = await Promise.all(
    attachments.map((attachment) => normalizeOne(ctx, userId, attachment, consumedSessionIds)),
  );
  const totalBytes = normalized.reduce((sum, attachment) => sum + (attachment.sizeBytes ?? 0), 0);
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new ConvexError({ code: "VALIDATION", message: "Attachments too large. Max total size is 25 MB." });
  }
  return normalized;
}
