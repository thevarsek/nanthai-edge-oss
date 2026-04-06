// convex/push/mutations_internal.ts
// =============================================================================
// Internal mutations for push notification management (not user-facing).
// =============================================================================

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/**
 * Delete a stale device token (called when APNs returns 410 Gone).
 */
export const deleteStaleToken = internalMutation({
  args: { tokenId: v.id("deviceTokens") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.tokenId);
    if (existing) {
      await ctx.db.delete(args.tokenId);
      console.log(`[push] Deleted stale token ${existing.token.slice(0, 8)}...`);
    }
  },
});
