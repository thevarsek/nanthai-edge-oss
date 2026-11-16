// convex/preferences/store_verification_admission.ts
// =============================================================================
// Bounds the store verification calls that purchase sync can trigger.
//
// syncEntitlement / syncPlayEntitlement schedule an App Store or Play lookup.
// Each user gets at most STORE_VERIFICATIONS_PER_HOUR scheduled lookups per
// hour, and an identifier the store rejected is not looked up again for
// STORE_REJECTION_CACHE_MS. Over the limit, sync returns normally without
// scheduling; clients re-sync on launch.
// =============================================================================

import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { sha256Hex } from "../scheduledJobs/trigger_auth";

export const STORE_VERIFICATIONS_PER_HOUR = 10;
export const STORE_REJECTION_CACHE_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const ATTEMPT_RETENTION_MS = 24 * HOUR_MS;
const CLEANUP_BATCH_SIZE = 500;

export type VerificationStore = "app_store" | "play_store";

/**
 * Records a verification attempt and returns its ID, or null when the user is
 * over the hourly limit or the store recently rejected this identifier.
 */
export async function admitStoreVerification(
  ctx: MutationCtx,
  args: { userId: string; store: VerificationStore; purchaseId: string; now: number },
): Promise<Id<"storeVerificationAttempts"> | null> {
  const purchaseKey = await sha256Hex(`${args.store}:${args.purchaseId}`);
  // The rejection window is shorter than the hour, so one hourly read covers both.
  const recent = await ctx.db
    .query("storeVerificationAttempts")
    .withIndex("by_user", (q) => q.eq("userId", args.userId).gt("createdAt", args.now - HOUR_MS))
    .take(STORE_VERIFICATIONS_PER_HOUR);
  if (recent.length >= STORE_VERIFICATIONS_PER_HOUR) return null;
  const recentlyRejected = recent.some((attempt) =>
    attempt.purchaseKey === purchaseKey &&
    attempt.rejectedAt !== undefined &&
    args.now - attempt.rejectedAt < STORE_REJECTION_CACHE_MS,
  );
  if (recentlyRejected) return null;
  return await ctx.db.insert("storeVerificationAttempts", {
    userId: args.userId,
    store: args.store,
    purchaseKey,
    createdAt: args.now,
  });
}

/** Marks an attempt the store definitively rejected, for the negative cache. */
export const markStoreVerificationRejected = internalMutation({
  args: { attemptId: v.id("storeVerificationAttempts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (attempt) await ctx.db.patch(attempt._id, { rejectedAt: Date.now() });
    return null;
  },
});

/** Hourly cron: removes attempts older than a day, one bounded batch per run. */
export const cleanupStoreVerificationAttempts = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("storeVerificationAttempts")
      .withIndex("by_created", (q) => q.lt("createdAt", Date.now() - ATTEMPT_RETENTION_MS))
      .take(CLEANUP_BATCH_SIZE);
    for (const attempt of expired) await ctx.db.delete(attempt._id);
    return expired.length;
  },
});
