import { v, ConvexError } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { assertEncryptedSecret } from "../lib/secret_crypto";

const NON_EXPIRING_MS = 10 * 365 * 24 * 60 * 60 * 1000;

export const getGmailManualConnection = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const connection = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", userId).eq("provider", "gmail_manual"),
      )
      .unique();

    if (!connection) return null;

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

export const upsertConnection = internalMutation({
  args: {
    userId: v.string(),
    email: v.string(),
    encryptedAccessToken: v.string(),
    encryptedRefreshToken: v.string(),
    secretEnvelopeVersion: v.literal(2),
    secretKeyId: v.string(),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email) {
      throw new ConvexError({ code: "VALIDATION", message: "Gmail address and app password are required." });
    }
    assertEncryptedSecret(args.encryptedAccessToken);
    assertEncryptedSecret(args.encryptedRefreshToken, true);

    const existing = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "gmail_manual"),
      )
      .unique();

    const now = Date.now();
    const expiresAt = now + NON_EXPIRING_MS;
    const patch = {
      accessToken: args.encryptedAccessToken,
      refreshToken: args.encryptedRefreshToken,
      expiresAt,
      scopes: ["imap", "smtp"],
      email,
      displayName: email,
      status: "active",
      errorMessage: undefined,
      lastRefreshedAt: now,
      secretEnvelopeVersion: args.secretEnvelopeVersion,
      secretKeyId: args.secretKeyId,
      secretMigratedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("oauthConnections", {
      userId: args.userId,
      provider: "gmail_manual",
      ...patch,
      connectedAt: now,
    });
  },
});

export const getConnectionInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "gmail_manual"),
      )
      .unique();
  },
});

export const deleteConnection = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "gmail_manual"),
      )
      .unique();

    if (connection) {
      await ctx.db.delete(connection._id);
    }
  },
});
