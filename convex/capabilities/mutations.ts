import { internalMutation } from "../_generated/server";
import { ConvexError, v } from "convex/values";

export const setUserCapabilityInternal = internalMutation({
  args: {
    userId: v.string(),
    capability: v.union(
      v.literal("pro"),
      v.literal("mcpRuntime"),
    ),
    source: v.union(
      v.literal("manual_override"),
      v.literal("future_subscription"),
      v.literal("internal_grant"),
    ),
    active: v.boolean(),
    grantedBy: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    if (args.active && args.capability === "pro") {
      throw new ConvexError({ code: "FORBIDDEN" as const, message: "Pro grants are managed via purchase entitlements. Use purchase entitlements instead." });
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("userCapabilities")
      .withIndex("by_user_capability", (q) =>
        q.eq("userId", args.userId).eq("capability", args.capability).eq("status", "active"),
      )
      .first();

    if (args.active) {
      if (existing) {
        await ctx.db.patch(existing._id, {
          source: args.source,
          grantedBy: args.grantedBy,
          grantedAt: existing.grantedAt ?? now,
          revokedAt: undefined,
          expiresAt: args.expiresAt,
          metadata: args.metadata,
          updatedAt: now,
        });
        return existing._id;
      }

      return await ctx.db.insert("userCapabilities", {
        userId: args.userId,
        capability: args.capability,
        source: args.source,
        status: "active",
        grantedBy: args.grantedBy,
        grantedAt: now,
        revokedAt: undefined,
        expiresAt: args.expiresAt,
        metadata: args.metadata,
        updatedAt: now,
      });
    }

    const activeGrants = await ctx.db
      .query("userCapabilities")
      .withIndex("by_user_capability", (q) =>
        q.eq("userId", args.userId).eq("capability", args.capability).eq("status", "active"),
      )
      .collect();

    for (const grant of activeGrants) {
      await ctx.db.patch(grant._id, {
        status: "revoked",
        revokedAt: now,
        updatedAt: now,
      });
    }

    return activeGrants[0]?._id ?? null;
  },
});
