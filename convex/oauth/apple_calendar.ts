import { v, ConvexError } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import { encryptSecret } from "../lib/secret_crypto";
import { discoverAppleCalendars } from "../tools/apple/client";

const NON_EXPIRING_MS = 10 * 365 * 24 * 60 * 60 * 1000;

export const connectAppleCalendar = action({
  args: {
    appleId: v.string(),
    appSpecificPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const appleId = args.appleId.trim();
    const appSpecificPassword = args.appSpecificPassword.trim();

    if (!appleId || !appSpecificPassword) {
      throw new ConvexError({ code: "VALIDATION", message: "Apple ID and app-specific password are required." });
    }

    let calendars;
    try {
      calendars = await discoverAppleCalendars({
        username: appleId,
        appSpecificPassword,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("invalid credentials")) {
        throw new ConvexError({ code: "UNAUTHORIZED", message: "Apple Calendar sign-in failed. Confirm you're using the Apple ID that owns the iCloud Calendar and an Apple app-specific password." });
      }
      throw new ConvexError({ code: "EXTERNAL_SERVICE", message: "Apple Calendar connection failed. Check the credentials and try again." });
    }

    if (calendars.length === 0) {
      throw new ConvexError({ code: "NOT_FOUND", message: "No Apple calendars were found for this account." });
    }

    await ctx.runMutation(internal.oauth.apple_calendar.upsertConnection, {
      userId,
      appleId,
      appSpecificPassword: await encryptSecret(appSpecificPassword),
      displayName: calendars[0]?.displayName,
    });

    return {
      success: true,
      email: appleId,
      calendarCount: calendars.length,
    };
  },
});

export const upsertConnection = internalMutation({
  args: {
    userId: v.string(),
    appleId: v.string(),
    appSpecificPassword: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "apple_calendar"),
      )
      .unique();

    const now = Date.now();
    const expiresAt = now + NON_EXPIRING_MS;

    if (existing) {
      await ctx.db.patch(existing._id, {
        accessToken: args.appSpecificPassword,
        refreshToken: "",
        expiresAt,
        scopes: ["caldav"],
        email: args.appleId,
        displayName: args.displayName,
        status: "active",
        errorMessage: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("oauthConnections", {
      userId: args.userId,
      provider: "apple_calendar",
      accessToken: args.appSpecificPassword,
      refreshToken: "",
      expiresAt,
      scopes: ["caldav"],
      email: args.appleId,
      displayName: args.displayName,
      status: "active",
      connectedAt: now,
    });
  },
});

export const getAppleCalendarConnection = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const connection = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", userId).eq("provider", "apple_calendar"),
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

export const disconnectAppleCalendar = action({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const connection = await ctx.runQuery(
      internal.oauth.apple_calendar.getConnectionInternal,
      { userId },
    );

    if (!connection) {
      throw new ConvexError({ code: "NOT_FOUND", message: "No Apple Calendar connection found." });
    }

    await ctx.runMutation(internal.oauth.apple_calendar.deleteConnection, {
      userId,
    });

    return { success: true };
  },
});

export const getConnectionInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "apple_calendar"),
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
        q.eq("userId", args.userId).eq("provider", "apple_calendar"),
      )
      .unique();

    if (connection) {
      await ctx.db.delete(connection._id);
    }
  },
});
