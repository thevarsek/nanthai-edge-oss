// convex/preferences/queries.ts
// =============================================================================
// User Preferences & Model Settings queries.
// =============================================================================

import { v } from "convex/values";
import { query, internalQuery } from "../_generated/server";
import { optionalAuth } from "../lib/auth";
import { isUserPro } from "./entitlements";

// -- User Preferences ---------------------------------------------------------

/** Get the authenticated user's preferences (singleton). Returns null if none set. */
export const getPreferences = query({
  args: {},
  handler: async (ctx) => {
    const identity = await optionalAuth(ctx);
    if (!identity) {
      return null;
    }
    return await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .first();
  },
});

export const getProStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await optionalAuth(ctx);
    if (!identity) {
      return null;
    }

    const isPro = await isUserPro(ctx, identity.userId);
    return {
      isPro,
      source: isPro ? "entitlement" : "none",
    };
  },
});

// -- Model Settings -----------------------------------------------------------

/** Get per-model settings for a specific model ID. */
export const getModelSettings = query({
  args: { openRouterId: v.string() },
  handler: async (ctx, args) => {
    const identity = await optionalAuth(ctx);
    if (!identity) {
      return null;
    }
    return await ctx.db
      .query("modelSettings")
      .withIndex("by_user_model", (q) =>
        q.eq("userId", identity.userId).eq("openRouterId", args.openRouterId),
      )
      .first();
  },
});

/** List all model settings for the authenticated user. */
export const listModelSettings = query({
  args: {},
  handler: async (ctx) => {
    const identity = await optionalAuth(ctx);
    if (!identity) {
      return [];
    }
    return await ctx.db
      .query("modelSettings")
      .withIndex("by_user", (q) => q.eq("userId", identity.userId))
      .collect();
  },
});

// -- Pro Status ---------------------------------------------------------------

/** Internal: check if a user has Pro status (for use from actions via runQuery). */
export const checkProStatus = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await isUserPro(ctx, args.userId);
  },
});

/** Internal: get the user's default model ID (for scheduled job creation fallback). */
export const getUserDefaultModel = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    return prefs?.defaultModelId ?? null;
  },
});

/** Internal: get skill and integration defaults for the resolver. */
export const getSkillIntegrationDefaults = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    return {
      skillDefaults: prefs?.skillDefaults ?? undefined,
      integrationDefaults: prefs?.integrationDefaults ?? undefined,
    };
  },
});
