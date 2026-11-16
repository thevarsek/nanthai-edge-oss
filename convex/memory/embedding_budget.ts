import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { tryConsumeDailyUsage } from "../lib/daily_usage";

/** Reserves one platform-key embedding for the user's current UTC day. */
export const reservePlatformEmbedding = internalMutation({
  args: { userId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => await tryConsumeDailyUsage(ctx, args.userId, "platform_embeddings", 1),
});
