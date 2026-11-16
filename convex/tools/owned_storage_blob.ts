// convex/tools/owned_storage_blob.ts
// =============================================================================
// V8-safe ownership gate for tools that read a model-supplied storage ID.
//
// Files resolve through `resolveOwnedStorageFileInternal` (the resolver used by
// read_xlsx / read_pptx / edit_xlsx). Images resolve through
// `resolveOwnedStorageAttachments` (the resolver used by fetch_image), which
// also covers generated media. A storage ID the user does not own reads as
// "not available" and the blob is never loaded.
// =============================================================================

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

export type OwnedBlobResult =
  | { ok: true; blob: Blob; filename?: string }
  | { ok: false; error: string };

type StorageReader = Pick<ActionCtx, "runQuery" | "storage">;

async function loadBlob(ctx: StorageReader, storageId: string): Promise<Blob | null | "invalid"> {
  try {
    return await ctx.storage.get(storageId as Id<"_storage">);
  } catch {
    return "invalid";
  }
}

/** Loads a document/file blob only when the user owns it. */
export async function getOwnedFileBlob(
  ctx: StorageReader,
  userId: string,
  storageId: string,
  notAvailableMessage = "The requested file is not available to this user.",
): Promise<OwnedBlobResult> {
  let owned: { filename: string } | null;
  try {
    owned = await ctx.runQuery(internal.runtime.queries.resolveOwnedStorageFileInternal, {
      userId,
      storageId: storageId as Id<"_storage">,
    });
  } catch {
    return { ok: false, error: `Invalid storageId: "${storageId}"` };
  }
  if (!owned) return { ok: false, error: notAvailableMessage };
  const blob = await loadBlob(ctx, storageId);
  if (blob === "invalid") return { ok: false, error: `Invalid storageId: "${storageId}"` };
  if (!blob) return { ok: false, error: `File not found for storageId: "${storageId}"` };
  return { ok: true, blob, filename: owned.filename };
}

/** Loads an image blob (upload, generated file or generated media) only when owned. */
export async function getOwnedImageBlob(
  ctx: StorageReader,
  userId: string,
  storageId: string,
): Promise<OwnedBlobResult> {
  let owned: Array<{ storageId: string }>;
  try {
    owned = await ctx.runQuery(internal.tools.storage_attachment_queries.resolveOwnedStorageAttachments, {
      userId,
      storageIds: [storageId as Id<"_storage">],
    });
  } catch {
    return { ok: false, error: `Invalid image storage ID: ${storageId}` };
  }
  if (!owned.some((item) => item.storageId === storageId)) {
    return { ok: false, error: `Image is not available to this user: ${storageId}` };
  }
  const blob = await loadBlob(ctx, storageId);
  if (blob === "invalid") return { ok: false, error: `Invalid image storage ID: ${storageId}` };
  if (!blob) return { ok: false, error: `Image not found in storage: ${storageId}` };
  return { ok: true, blob };
}
