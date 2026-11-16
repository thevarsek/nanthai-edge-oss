// convex/account/clerk_webhook_events.ts
// Applies verified Clerk user lifecycle events. Recording the delivery ID and
// applying the event share one transaction, so a replayed delivery is a no-op.

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalMutation } from "../_generated/server";
import { blockUserHandler, unblockUserHandler } from "../security/account_access_blocks";
import { beginAccountDeletionHandler } from "./deletion_state";

/** Deliveries are kept well beyond the 5-minute signature tolerance. */
export const WEBHOOK_DELIVERY_RETENTION_MS = 24 * 60 * 60_000;
const IDENTITY_DELETION_RETRY_MS = 30_000;
const IDENTITY_DELETION_MAX_ATTEMPTS = 120;

export const applyClerkWebhookEvent = internalMutation({
  args: {
    deliveryId: v.string(),
    eventType: v.string(),
    userId: v.optional(v.string()),
    banned: v.optional(v.boolean()),
    locked: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const seen = await ctx.db.query("identityWebhookDeliveries")
      .withIndex("by_delivery", q => q.eq("deliveryId", args.deliveryId)).first();
    if (seen) return "duplicate";
    await ctx.db.insert("identityWebhookDeliveries", {
      deliveryId: args.deliveryId,
      eventType: args.eventType.slice(0, 100),
      receivedAt: Date.now(),
    });
    const userId = args.userId;
    if (!userId) return "ignored";
    if (args.eventType === "user.updated") {
      if (args.banned || args.locked) {
        await blockUserHandler(ctx, {
          userId,
          source: "clerk",
          reason: args.banned ? "Banned in Clerk" : "Locked in Clerk",
        });
        return "blocked";
      }
      const { removed } = await unblockUserHandler(ctx, { userId, source: "clerk" });
      return removed ? "unblocked" : "ignored";
    }
    if (args.eventType === "user.deleted") {
      await beginAccountDeletionHandler(ctx, userId);
      await ctx.scheduler.runAfter(0, internal.account.clerk_webhook_events.continueIdentityDeletion, { userId, attempt: 0 });
      return "deleting";
    }
    return "ignored";
  },
});

/**
 * Same cancellation-then-purge path as in-app account deletion, driven by the
 * identity provider instead of a signed-in client.
 */
export const continueIdentityDeletion = internalAction({
  args: { userId: v.string(), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cancelled: boolean = await ctx.runAction(internal.execution.teardown.cancelUserExecutions, {
      userId: args.userId,
      reason: "Account deleted",
    });
    if (!cancelled) {
      if (args.attempt < IDENTITY_DELETION_MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(IDENTITY_DELETION_RETRY_MS, internal.account.clerk_webhook_events.continueIdentityDeletion, {
          userId: args.userId,
          attempt: args.attempt + 1,
        });
      } else {
        console.error("[clerk-webhook] identity deletion cancellation did not settle", { attempts: args.attempt });
      }
      return null;
    }
    // The purge continues itself until every table is done.
    await ctx.runAction(internal.account.actions.continueAccountDeletionPurge, { userId: args.userId });
    return null;
  },
});

/** Hourly: forget webhook delivery IDs older than the retention window. */
export const pruneWebhookDeliveries = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - WEBHOOK_DELIVERY_RETENTION_MS;
    const stale = await ctx.db.query("identityWebhookDeliveries")
      .withIndex("by_received", q => q.lt("receivedAt", cutoff)).take(500);
    for (const row of stale) await ctx.db.delete(row._id);
    return stale.length;
  },
});
