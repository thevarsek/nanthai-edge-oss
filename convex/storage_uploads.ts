import { v } from "convex/values";
import { internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { assertOwnedStorage } from "./lib/storage_ownership";
import { isAccountActive } from "./lib/account_access";
import { dailyUsageAmount, remainingDailyUsage, tryConsumeDailyUsage } from "./lib/daily_usage";
import { sha256Hex } from "./scheduledJobs/trigger_auth";

/** Native upload URLs last about an hour; the capability never outlives them. */
export const UPLOAD_TOKEN_TTL_MS = 60 * 60 * 1000;

const claimResult = v.union(
  v.object({ status: v.literal("claimed"), uploadId: v.id("clientStorageUploads"), uploadUrl: v.string() }),
  v.object({ status: v.union(v.literal("unauthorized"), v.literal("quota")) }),
);

/**
 * Claims an upload token for one request. A token streams one body: a second
 * use while the first runs, or after it succeeded, is unauthorized.
 */
export const claimUpload = internalMutation({
  args: { tokenHash: v.string(), declaredBytes: v.optional(v.number()) },
  returns: claimResult,
  handler: async (ctx, args) => {
    const upload = await ctx.db.query("clientStorageUploads")
      .withIndex("by_token", q => q.eq("tokenHash", args.tokenHash)).first();
    const now = Date.now();
    if (!upload?.uploadUrl || upload.claimedAt !== undefined || upload.createdAt + UPLOAD_TOKEN_TTL_MS <= now) {
      return { status: "unauthorized" as const };
    }
    if (!await isAccountActive(ctx.db, upload.userId)) return { status: "unauthorized" as const };
    const remaining = remainingDailyUsage(await dailyUsageAmount(ctx, upload.userId, "upload_bytes", now), "upload_bytes");
    if (remaining <= 0 || (args.declaredBytes !== undefined && args.declaredBytes > remaining)) {
      return { status: "quota" as const };
    }
    await ctx.db.patch(upload._id, { claimedAt: now });
    return { status: "claimed" as const, uploadId: upload._id, uploadUrl: upload.uploadUrl };
  },
});

/** Returns a token whose upload never reached storage, so the client can retry it. */
export const releaseUpload = internalMutation({
  args: { uploadId: v.id("clientStorageUploads") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (upload?.uploadUrl && upload.claimedAt !== undefined) await ctx.db.patch(upload._id, { claimedAt: undefined });
    return null;
  },
});

export const completeUpload = internalMutation({
  args: { uploadId: v.id("clientStorageUploads"), storageId: v.id("_storage") },
  returns: v.union(v.literal("saved"), v.literal("rejected"), v.literal("quota")),
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload?.uploadUrl) return "rejected" as const;
    if (!await isAccountActive(ctx.db, upload.userId)) return "rejected" as const;
    const existing = await ctx.db.query("clientStorageUploads")
      .withIndex("by_storage", q => q.eq("storageId", args.storageId)).first();
    if (existing) return existing.userId === upload.userId ? "saved" as const : "rejected" as const;
    const size = (await ctx.db.system.get(args.storageId))?.size ?? 0;
    if (!await tryConsumeDailyUsage(ctx, upload.userId, "upload_bytes", size)) return "quota" as const;
    await ctx.db.insert("clientStorageUploads", {
      userId: upload.userId, storageId: args.storageId, sweepEligible: true, createdAt: Date.now(),
    });
    // The token has done its one job.
    await ctx.db.delete(upload._id);
    return "saved" as const;
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

function declaredBytes(request: Request): number | undefined {
  const value = Number(request.headers.get("Content-Length"));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export async function uploadStorageHttp(ctx: ActionCtx, request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return new Response(null, { status: 401, headers });
  const claim = await ctx.runMutation(internal.storage_uploads.claimUpload, {
    tokenHash: await sha256Hex(token), declaredBytes: declaredBytes(request),
  });
  if (claim.status === "quota") return new Response(null, { status: 413, headers });
  if (claim.status !== "claimed") return new Response(null, { status: 401, headers });
  // Stream to the native storage endpoint rather than buffering large uploads.
  let response: Response;
  try {
    response = await fetch(claim.uploadUrl, {
      method: "POST", body: request.body,
      headers: { "Content-Type": request.headers.get("Content-Type") ?? "application/octet-stream" },
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  } catch {
    await ctx.runMutation(internal.storage_uploads.releaseUpload, { uploadId: claim.uploadId });
    return new Response(null, { status: 502, headers });
  }
  if (!response.ok) {
    await ctx.runMutation(internal.storage_uploads.releaseUpload, { uploadId: claim.uploadId });
    return new Response(null, { status: response.status, headers });
  }
  const { storageId } = await response.json() as { storageId: Id<"_storage"> };
  const saved = await ctx.runMutation(internal.storage_uploads.completeUpload, { uploadId: claim.uploadId, storageId });
  if (saved !== "saved") {
    await ctx.storage.delete(storageId);
    return new Response(null, { status: saved === "quota" ? 413 : 409, headers });
  }
  return Response.json({ storageId }, { headers });
}
