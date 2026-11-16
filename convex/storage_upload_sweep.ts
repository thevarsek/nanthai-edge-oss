// convex/storage_upload_sweep.ts
// =============================================================================
// Reclaims client uploads that nothing kept. A blob uploaded through
// `/storage/upload` that is still unreferenced 24 hours later was abandoned
// (a cancelled send, a closed editor, a one-off memory import).
//
// Safety rules:
//   * Only rows written by the current upload route (`sweepEligible`) are
//     candidates. Earlier rows may have consumers this sweep cannot see, so
//     it never deletes them.
//   * Every consumer of a client upload records the storage ID in an indexed
//     table; the sweep checks all of them. Any reference keeps the blob and
//     retires the row from the sweep for good.
//   * Pending chat upload sessions belong to their own 24-hour cleanup.
// =============================================================================

import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { storageHasDurableReferences } from "./knowledge_base/delete_helpers";
import { pruneDailyUsage } from "./lib/daily_usage";

export const UNREFERENCED_UPLOAD_RETENTION_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH_SIZE = 25;
const USAGE_PRUNE_BATCH_SIZE = 100;

export async function uploadHasDurableReference(
  ctx: MutationCtx,
  userId: string,
  storageId: Id<"_storage">,
): Promise<boolean> {
  if (await storageHasDurableReferences(ctx, userId, storageId)) return true;
  const [chatSessions, document, presentationSource] = await Promise.all([
    ctx.db.query("chatUploadSessions")
      .withIndex("by_user_storage", (q) => q.eq("userId", userId).eq("storageId", storageId))
      .take(20),
    ctx.db.query("documents")
      .withIndex("by_source_storage", (q) => q.eq("sourceStorageId", storageId))
      .first(),
    ctx.db.query("presentationAssets")
      .withIndex("by_user_source", (q) => q.eq("userId", userId).eq("sourceStorageId", storageId))
      .first(),
  ]);
  return chatSessions.some((session) => session.status !== "cancelled") || !!document || !!presentationSource;
}

export interface UploadSweepResult {
  deletedBlobs: number;
  keptBlobs: number;
  expiredTokens: number;
  prunedUsageRows: number;
}

export async function sweepUnreferencedUploadsHandler(
  ctx: MutationCtx,
  now = Date.now(),
): Promise<UploadSweepResult> {
  const cutoff = now - UNREFERENCED_UPLOAD_RETENTION_MS;
  const rows = await ctx.db.query("clientStorageUploads")
    .withIndex("by_sweep_created", (q) => q.eq("sweepEligible", true).lt("createdAt", cutoff))
    .take(SWEEP_BATCH_SIZE);
  const result: UploadSweepResult = { deletedBlobs: 0, keptBlobs: 0, expiredTokens: 0, prunedUsageRows: 0 };
  for (const row of rows) {
    if (!row.storageId) {
      // An unused or failed upload token; its native URL expired long ago.
      await ctx.db.delete(row._id);
      result.expiredTokens += 1;
      continue;
    }
    if (await uploadHasDurableReference(ctx, row.userId, row.storageId)) {
      await ctx.db.patch(row._id, { sweepEligible: undefined });
      result.keptBlobs += 1;
      continue;
    }
    try {
      await ctx.storage.delete(row.storageId);
    } catch {
      // Already gone.
    }
    await ctx.db.delete(row._id);
    result.deletedBlobs += 1;
  }
  result.prunedUsageRows = await pruneDailyUsage(ctx, now, USAGE_PRUNE_BATCH_SIZE);
  return result;
}

export const sweepUnreferencedUploads = internalMutation({
  args: {},
  returns: v.object({
    deletedBlobs: v.number(),
    keptBlobs: v.number(),
    expiredTokens: v.number(),
    prunedUsageRows: v.number(),
  }),
  handler: async (ctx) => await sweepUnreferencedUploadsHandler(ctx),
});
