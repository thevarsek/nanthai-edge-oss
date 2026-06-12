import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { deriveAnalyticsIdForClerkUserId } from "./analytics_id";

export const getAnalyticsIdentity = query({
  args: {
    clerkUserId: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      analyticsId: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    if (args.clerkUserId !== undefined && args.clerkUserId !== userId) {
      return null;
    }
    const analyticsId = await deriveAnalyticsIdForClerkUserId(userId);
    return analyticsId ? { analyticsId } : null;
  },
});
