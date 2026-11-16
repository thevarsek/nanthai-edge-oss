import { defineTable } from "convex/server";
import { v } from "convex/values";

export const accountAccessSchemaTables = {
  /**
   * Account access block. While a row exists every authenticated path fails
   * with ACCOUNT_BLOCKED and background writers stop at their fences. One row
   * per user; an admin block outranks an identity-provider block.
   */
  accountAccessBlocks: defineTable({
    userId: v.string(),
    reason: v.string(),
    source: v.union(v.literal("clerk"), v.literal("admin")),
    blockedAt: v.number(),
    /** Cursor for the shared account run-tree cancellation sweep. */
    cancellationCursor: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  /** Identity-provider webhook delivery IDs kept for replay protection. */
  identityWebhookDeliveries: defineTable({
    deliveryId: v.string(),
    eventType: v.string(),
    receivedAt: v.number(),
  })
    .index("by_delivery", ["deliveryId"])
    .index("by_received", ["receivedAt"]),
};
