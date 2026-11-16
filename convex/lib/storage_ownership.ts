import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sha256Hex } from "../scheduledJobs/trigger_auth";

/** The upload URL is the upload capability; the server records its resulting blob. */
export async function createOwnedUploadUrl(ctx: MutationCtx, userId: string): Promise<string> {
  const uploadToken = crypto.randomUUID();
  await ctx.db.insert("clientStorageUploads", {
    userId, tokenHash: await sha256Hex(uploadToken), uploadUrl: await ctx.storage.generateUploadUrl(), createdAt: Date.now(),
  });
  return `${process.env.CONVEX_SITE_URL}/storage/upload?token=${uploadToken}`;
}

export async function ownsUploadedStorage(
  ctx: Pick<QueryCtx, "db">, userId: string, storageId: Id<"_storage">,
): Promise<boolean> {
  const upload = await ctx.db.query("clientStorageUploads")
    .withIndex("by_storage", q => q.eq("storageId", storageId)).first();
  return upload?.userId === userId;
}

export async function assertOwnedUploadedStorage(
  ctx: Pick<QueryCtx, "db">, userId: string, storageId: Id<"_storage">,
): Promise<void> {
  if (!await ownsUploadedStorage(ctx, userId, storageId)) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Uploaded file is missing or not owned by user." });
  }
}

/** Existing durable files keep working; pending client sessions alone are not proof. */
export async function assertOwnedStorage(
  ctx: Pick<QueryCtx, "db">, userId: string, storageId: Id<"_storage">,
): Promise<void> {
  const upload = await ctx.db.query("clientStorageUploads")
    .withIndex("by_storage", q => q.eq("storageId", storageId)).first();
  if (upload) {
    if (upload.userId === userId) return;
  } else {
    const records = await Promise.all([
      ctx.db.query("fileAttachments").withIndex("by_storage", q => q.eq("storageId", storageId)).first(),
      ctx.db.query("generatedFiles").withIndex("by_storage", q => q.eq("storageId", storageId)).first(),
      ctx.db.query("generatedMedia").withIndex("by_storageId", q => q.eq("storageId", storageId)).first(),
      ctx.db.query("documentVersions").withIndex("by_storage", q => q.eq("storageId", storageId)).first(),
      ctx.db.query("personas").withIndex("by_avatar_storage", q => q.eq("avatarImageStorageId", storageId)).first(),
    ]);
    const owners = records.filter(record => record !== null);
    if (owners.length && owners.every(record => record.userId === userId)) return;
  }
  throw new ConvexError({ code: "FORBIDDEN", message: "File is missing or not owned by user." });
}
