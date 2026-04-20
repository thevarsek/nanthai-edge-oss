import { v, ConvexError } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import { validateClozeApiKey } from "../tools/cloze/client";

// Cloze API keys do not expire. We mirror the Apple Calendar pattern and
// stamp a 10-year expiry so the generic oauthConnections TTL logic never
// flags the row as stale. The `scopes` field carries an "api_key" marker so
// the future OAuth2 branch can be added as a one-line check in the auth
// helper without a schema change.
const NON_EXPIRING_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const API_KEY_SCOPE_MARKER = "api_key";

export const connectCloze = action({
  args: {
    apiKey: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const apiKey = args.apiKey.trim();
    const label = args.label?.trim() || undefined;

    if (!apiKey) {
      throw new ConvexError({
        code: "VALIDATION",
        message: "A Cloze API key is required.",
      });
    }

    let profile;
    try {
      profile = await validateClozeApiKey(apiKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lower = message.toLowerCase();
      if (
        lower.includes("unauthorized") ||
        lower.includes("invalid") ||
        lower.includes("401") ||
        lower.includes("403")
      ) {
        throw new ConvexError({
          code: "UNAUTHORIZED",
          message:
            "Cloze sign-in failed. Double-check the API key you generated in Cloze Settings → Accounts and Services → API Key.",
        });
      }
      throw new ConvexError({
        code: "EXTERNAL_SERVICE",
        message: "Cloze connection failed. Check the API key and try again.",
      });
    }

    await ctx.runMutation(internal.oauth.cloze.upsertConnection, {
      userId,
      apiKey,
      email: profile.email,
      displayName: label ?? profile.displayName,
    });

    return {
      success: true,
      email: profile.email ?? null,
      displayName: label ?? profile.displayName ?? null,
    };
  },
});

export const upsertConnection = internalMutation({
  args: {
    userId: v.string(),
    apiKey: v.string(),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "cloze"),
      )
      .unique();

    const now = Date.now();
    const expiresAt = now + NON_EXPIRING_MS;

    if (existing) {
      await ctx.db.patch(existing._id, {
        accessToken: args.apiKey,
        refreshToken: "",
        expiresAt,
        scopes: [API_KEY_SCOPE_MARKER],
        email: args.email,
        displayName: args.displayName,
        status: "active",
        errorMessage: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("oauthConnections", {
      userId: args.userId,
      provider: "cloze",
      accessToken: args.apiKey,
      refreshToken: "",
      expiresAt,
      scopes: [API_KEY_SCOPE_MARKER],
      email: args.email,
      displayName: args.displayName,
      status: "active",
      connectedAt: now,
    });
  },
});

export const getClozeConnection = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const connection = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", userId).eq("provider", "cloze"),
      )
      .unique();

    if (!connection) {
      return null;
    }

    return {
      id: connection._id,
      email: connection.email ?? null,
      displayName: connection.displayName ?? null,
      status: connection.status,
      scopes: connection.scopes,
      connectedAt: connection.connectedAt,
      lastUsedAt: connection.lastUsedAt ?? null,
      errorMessage: connection.errorMessage ?? null,
    };
  },
});

export const disconnectCloze = action({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const connection = await ctx.runQuery(
      internal.oauth.cloze.getConnectionInternal,
      { userId },
    );

    if (!connection) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "No Cloze connection found.",
      });
    }

    await ctx.runMutation(internal.oauth.cloze.deleteConnection, { userId });

    return { success: true };
  },
});

export const getConnectionInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "cloze"),
      )
      .unique();
  },
});

export const markConnectionExpired = internalMutation({
  args: { userId: v.string(), errorMessage: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "cloze"),
      )
      .unique();

    if (connection) {
      await ctx.db.patch(connection._id, {
        status: "expired",
        errorMessage: args.errorMessage,
      });
    }
  },
});

export const deleteConnection = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "cloze"),
      )
      .unique();

    if (connection) {
      await ctx.db.delete(connection._id);
    }
  },
});
