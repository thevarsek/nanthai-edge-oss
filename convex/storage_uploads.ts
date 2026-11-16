import { v } from "convex/values";
import { internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertOwnedStorage } from "./lib/storage_ownership";
import { sha256Hex } from "./scheduledJobs/trigger_auth";

export const getUpload = internalQuery({
  args: { tokenHash: v.string() },
  returns: v.union(v.object({ uploadId: v.id("clientStorageUploads"), uploadUrl: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const upload = await ctx.db.query("clientStorageUploads")
      .withIndex("by_token", q => q.eq("tokenHash", args.tokenHash)).first();
    if (!upload?.uploadUrl) return null;
    const deleted = await ctx.db.query("accountDeletionTombstones")
      .withIndex("by_user", q => q.eq("userId", upload.userId)).unique();
    return deleted ? null : { uploadId: upload._id, uploadUrl: upload.uploadUrl };
  },
});

export const completeUpload = internalMutation({
  args: { uploadId: v.id("clientStorageUploads"), storageId: v.id("_storage") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload?.uploadUrl) return false;
    const deleted = await ctx.db.query("accountDeletionTombstones")
      .withIndex("by_user", q => q.eq("userId", upload.userId)).unique();
    if (deleted) return false;
    const existing = await ctx.db.query("clientStorageUploads")
      .withIndex("by_storage", q => q.eq("storageId", args.storageId)).first();
    if (existing) return existing.userId === upload.userId;
    await ctx.db.insert("clientStorageUploads", {
      userId: upload.userId, storageId: args.storageId, createdAt: Date.now(),
    });
    return true;
  },
});

export const assertOwnedUpload = internalQuery({
  args: { userId: v.string(), storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertOwnedStorage(ctx, args.userId, args.storageId);
    return null;
  },
});

const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
export async function uploadStorageHttp(ctx: ActionCtx, request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return new Response(null, { status: 401, headers });
  const upload = await ctx.runQuery(internal.storage_uploads.getUpload, { tokenHash: await sha256Hex(token) });
  if (!upload) return new Response(null, { status: 401, headers });
  // Stream to the native storage endpoint rather than buffering large uploads.
  const response = await fetch(upload.uploadUrl, {
    method: "POST", body: request.body,
    headers: { "Content-Type": request.headers.get("Content-Type") ?? "application/octet-stream" },
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (!response.ok) return new Response(null, { status: response.status, headers });
  const { storageId } = await response.json() as { storageId: import("./_generated/dataModel").Id<"_storage"> };
  const saved = await ctx.runMutation(internal.storage_uploads.completeUpload, { uploadId: upload.uploadId, storageId });
  if (!saved) {
    await ctx.storage.delete(storageId);
    return new Response(null, { status: 409, headers });
  }
  return Response.json({ storageId }, { headers });
}
