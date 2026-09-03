"use node";

import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { ToolExecutionContext } from "./registry";
export { STORAGE_ATTACHMENTS_PARAMETER } from "./storage_attachment_schema";

const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

interface AttachmentRequest {
  storageId: Id<"_storage">;
  filename?: string;
  contentType?: string;
}

export interface ResolvedStorageAttachment {
  storageId: Id<"_storage">;
  filename: string;
  contentType: string;
  content: Buffer;
  contentBase64: string;
  sizeBytes: number;
}

function safeFilename(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[\r\n/\\\0]+/g, " ").trim().slice(0, 180);
  return normalized || undefined;
}

function safeContentType(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized)
    ? normalized
    : undefined;
}

function parseRequests(value: unknown): AttachmentRequest[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("'attachments' must be an array.");
  if (value.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`At most ${MAX_ATTACHMENT_COUNT} attachments are supported.`);
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Each attachment must be an object.");
    const raw = entry as Record<string, unknown>;
    if (typeof raw.storage_id !== "string" || !raw.storage_id.trim()) {
      throw new Error("Each attachment requires a storage_id.");
    }
    return {
      storageId: raw.storage_id.trim() as Id<"_storage">,
      filename: safeFilename(raw.filename),
      contentType: safeContentType(raw.content_type),
    };
  });
}

export async function resolveStorageAttachments(
  toolCtx: ToolExecutionContext,
  value: unknown,
): Promise<ResolvedStorageAttachment[]> {
  const requests = parseRequests(value);
  if (requests.length === 0) return [];
  const owned = await toolCtx.ctx.runQuery(
    internal.tools.storage_attachment_queries.resolveOwnedStorageAttachments,
    { userId: toolCtx.userId, storageIds: requests.map((item) => item.storageId) },
  );
  const ownedById = new Map(owned.map((item) => [String(item.storageId), item]));
  const results: ResolvedStorageAttachment[] = [];
  let totalBytes = 0;
  for (const request of requests) {
    const metadata = ownedById.get(String(request.storageId));
    if (!metadata) throw new Error("An attachment is missing or does not belong to the current user.");
    if ((metadata.sizeBytes ?? 0) > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment '${metadata.filename}' exceeds the 20 MB limit.`);
    }
    const url = await toolCtx.ctx.storage.getUrl(request.storageId);
    if (!url) throw new Error(`Attachment '${metadata.filename}' is unavailable in storage.`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Attachment '${metadata.filename}' could not be read.`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_BYTES) {
      await response.body?.cancel();
      throw new Error(`Attachment '${metadata.filename}' exceeds the 20 MB limit.`);
    }
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment '${metadata.filename}' exceeds the 20 MB limit.`);
    }
    totalBytes += content.length;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error("Combined attachments exceed the 20 MB limit.");
    }
    results.push({
      storageId: request.storageId,
      filename: request.filename ?? metadata.filename,
      contentType: request.contentType ?? metadata.mimeType,
      content,
      contentBase64: content.toString("base64"),
      sizeBytes: content.length,
    });
  }
  return results;
}
