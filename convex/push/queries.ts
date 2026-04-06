// convex/push/queries.ts
// =============================================================================
// Internal queries for push notification delivery.
// =============================================================================

import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

/**
 * Get all device tokens for a user. Used by sendPushNotification action.
 */
export const getDeviceTokens = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("deviceTokens")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});
