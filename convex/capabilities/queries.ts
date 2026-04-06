import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { optionalAuth } from "../lib/auth";
import { getAccountCapabilities, hasCapability, listActiveCapabilities } from "./shared";

export const getAccountCapabilitiesPublic = query({
  args: {},
  handler: async (ctx) => {
    const auth = await optionalAuth(ctx);
    if (!auth) return null;
    return await getAccountCapabilities(ctx, auth.userId);
  },
});

export const listCapabilitiesInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await listActiveCapabilities(ctx, args.userId);
  },
});

export const hasCapabilityInternal = internalQuery({
  args: {
    userId: v.string(),
    capability: v.union(
      v.literal("pro"),
      v.literal("sandboxRuntime"),
      v.literal("mcpRuntime"),
    ),
  },
  handler: async (ctx, args) => {
    return await hasCapability(ctx, args.userId, args.capability);
  },
});

export const getAccountCapabilitiesInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await getAccountCapabilities(ctx, args.userId);
  },
});
