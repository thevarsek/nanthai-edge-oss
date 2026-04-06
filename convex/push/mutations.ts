// convex/push/mutations.ts
// =============================================================================
// Device token registration and removal for provider-based push notifications.
// =============================================================================

import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { pushPlatform, pushProvider } from "../schema_validators";

const apnsEnvironment = v.union(v.literal("sandbox"), v.literal("production"));

/**
 * Register (upsert) a provider device token for the current user.
 * Called on every app launch to keep the token fresh.
 * If the token already exists for this user, updates the timestamp.
 */
export const registerDeviceToken = mutation({
  args: {
    token: v.string(),
    platform: v.optional(pushPlatform),
    provider: v.optional(pushProvider),
    environment: v.optional(apnsEnvironment),
    subscription: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const platform = args.platform ?? "ios";
    const provider = args.provider ?? "apns";

    if (provider === "apns" && args.environment === undefined) {
      throw new ConvexError({
        code: "INVALID_ARGUMENT" as const,
        message: "APNs device token registration requires environment",
      });
    }

    if (provider !== "apns" && args.environment !== undefined) {
      throw new ConvexError({
        code: "INVALID_ARGUMENT" as const,
        message: "Environment is only supported for APNs device tokens",
      });
    }

    if (provider === "webpush" && !args.subscription) {
      throw new ConvexError({
        code: "INVALID_ARGUMENT" as const,
        message: "Web push registration requires subscription payload",
      });
    }

    const tokenPayload = {
      userId,
      token: args.token,
      platform,
      provider,
      ...(provider === "webpush" && args.subscription
        ? { subscription: args.subscription }
        : {}),
      ...(provider === "apns" && args.environment !== undefined
        ? { environment: args.environment }
        : {}),
      updatedAt: Date.now(),
    };

    // Check if this exact token already exists
    const existing = await ctx.db
      .query("deviceTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (existing) {
      // Update timestamp (and userId in case token migrated between accounts)
      // and normalize the payload to remove stale optional fields.
      await ctx.db.replace(existing._id, tokenPayload);
      return existing._id;
    }

    // Insert new token
    return await ctx.db.insert("deviceTokens", tokenPayload);
  },
});

/**
 * Remove a specific device token. Called on sign-out to stop
 * receiving push notifications for this device.
 */
export const removeDeviceToken = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const existing = await ctx.db
      .query("deviceTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (existing && existing.userId === userId) {
      await ctx.db.delete(existing._id);
    }
  },
});
