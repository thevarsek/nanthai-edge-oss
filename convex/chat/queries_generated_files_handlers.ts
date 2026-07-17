import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { optionalAuth } from "../lib/auth";
import { getAuthorizedMessage } from "./query_helpers";

export interface GetGeneratedFilesByMessageArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
}

export interface GetGeneratedFilesByIdsArgs extends Record<string, unknown> {
  fileIds: Id<"generatedFiles">[];
}

type GeneratedFileProjection = {
  _id: string;
  _creationTime: number;
  userId: string;
  chatId: string;
  messageId: string;
  storageId: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  toolName: string;
  documentId?: string;
  documentVersionId?: string;
  presentationProjectId?: string;
  presentationRevision?: number;
  createdAt: number;
  downloadUrl: string | null;
};

async function generatedFileProjection(
  ctx: QueryCtx,
  file: Doc<"generatedFiles">,
): Promise<GeneratedFileProjection> {
  const storageUrl = await ctx.storage.getUrl(file.storageId);
  const siteUrl = process.env.CONVEX_SITE_URL?.trim().replace(/\/$/, "");
  const downloadUrl = siteUrl
    ? `${siteUrl}/download?storageId=${encodeURIComponent(file.storageId)}&filename=${encodeURIComponent(file.filename)}`
    : storageUrl;
  return {
    _id: file._id,
    _creationTime: file._creationTime,
    userId: file.userId,
    chatId: file.chatId,
    messageId: file.messageId,
    storageId: file.storageId,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    toolName: file.toolName,
    documentId: file.documentId,
    documentVersionId: file.documentVersionId,
    presentationProjectId: file.presentationProjectId,
    presentationRevision: file.presentationRevision,
    createdAt: file.createdAt,
    downloadUrl,
  };
}

export async function getGeneratedFilesByMessageHandler(
  ctx: QueryCtx,
  args: GetGeneratedFilesByMessageArgs,
): Promise<GeneratedFileProjection[]> {
  const auth = await optionalAuth(ctx);
  if (!auth) return [];
  const message = await getAuthorizedMessage(ctx, args.messageId, auth.userId);
  if (!message) return [];
  const files = await ctx.db
    .query("generatedFiles")
    .withIndex("by_message", (query) => query.eq("messageId", args.messageId))
    .collect();
  return Promise.all(files.map((file) => generatedFileProjection(ctx, file)));
}

const MAX_GENERATED_FILE_LOOKUP_IDS = 100;

/** Resolve a bounded set of user-owned generated files for compact graph views. */
export async function getGeneratedFilesByIdsHandler(
  ctx: QueryCtx,
  args: GetGeneratedFilesByIdsArgs,
): Promise<GeneratedFileProjection[]> {
  const auth = await optionalAuth(ctx);
  if (!auth || args.fileIds.length === 0) return [];
  const uniqueIds = [...new Set(args.fileIds)].slice(0, MAX_GENERATED_FILE_LOOKUP_IDS);
  const files = (await Promise.all(
    uniqueIds.map((fileId) => ctx.db.get("generatedFiles", fileId)),
  )).filter((file): file is Doc<"generatedFiles"> => file?.userId === auth.userId);
  return Promise.all(files.map((file) => generatedFileProjection(ctx, file)));
}
