// convex/security/credential_invalidation.ts
// =============================================================================
// Admin-only: invalidate stored credentials for specific
// users so their apps prompt them to reconnect. Everything here is internal
// (run with `npx convex run`); nothing is reachable from clients. No function
// returns or logs token values.
// =============================================================================

import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { deleteOpenRouterCredentials } from "../lib/openrouter_credentials";
import { invalidateConnection, type ConnectionInvalidation } from "./credential_invalidation_oauth";

const MAX_USERS_PER_CALL = 200;

export type UserInvalidationSummary = {
  userId: string;
  openRouterKeyPresent: boolean;
  openRouterKeyDeleted: boolean;
  oauthProviders: string[];
  connections: ConnectionInvalidation[];
  error?: string;
};

export type InvalidateUsersResult = {
  dryRun: boolean;
  totals: {
    users: number;
    usersWithOpenRouterKey: number;
    openRouterKeysDeleted: number;
    oauthConnectionsFound: number;
    oauthConnectionsRevoked: number;
    oauthConnectionsDeleted: number;
    connectionsNeedingUserAction: number;
    failedUsers: number;
  };
  users: UserInvalidationSummary[];
};

// ── Mutation / queries ──────────────────────────────────────────────────

/** Delete the user's OpenRouter key rows so clients prompt for reconnection. */
export const invalidateUserOpenRouterKey = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<{ deleted: boolean }> =>
    deleteOpenRouterCredentials(ctx, args.userId),
});

/** Metadata only (no token fields): what credentials a user currently has. */
export const inspectUserCredentials = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const secret = await ctx.db
      .query("userSecrets")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    const rows = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return {
      openRouterKeyPresent: secret !== null,
      oauthProviders: [...new Set(rows.map((row) => row.provider))].sort(),
    };
  },
});

/** Fallback for provider names without a dedicated `deleteConnection`. */
export const deleteOAuthConnectionsForProvider = internalMutation({
  args: { userId: v.string(), provider: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", args.provider),
      )
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length };
  },
});

/**
 * Revoke (best effort) and delete every OAuth/manual connection of one user.
 * A provider-side failure never prevents local deletion.
 */
export const revokeUserOAuthConnections = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<ConnectionInvalidation[]> => {
    const { oauthProviders } = await ctx.runQuery(
      internal.security.credential_invalidation.inspectUserCredentials,
      { userId: args.userId },
    );
    const results: ConnectionInvalidation[] = [];
    for (const provider of oauthProviders) {
      results.push(await invalidateConnection(ctx, args.userId, provider));
    }
    return results;
  },
});

// ── Batch entry point ───────────────────────────────────────────────────

function normalizeUserIds(userIds: string[]): string[] {
  const normalized = [...new Set(userIds.map((id) => id.trim()))];
  if (normalized.length === 0 || normalized.some((id) => id.length === 0)) {
    throw new ConvexError({
      code: "VALIDATION",
      message: "userIds must be a non-empty list of non-blank user IDs.",
    });
  }
  if (normalized.length > MAX_USERS_PER_CALL) {
    throw new ConvexError({
      code: "VALIDATION",
      message: `At most ${MAX_USERS_PER_CALL} users per call.`,
    });
  }
  return normalized;
}

/**
 * Invalidate stored credentials for the given users, one at a time.
 * `dryRun: true` only reports what exists; nothing is changed or contacted.
 */
export const invalidateUsers = internalAction({
  args: { userIds: v.array(v.string()), dryRun: v.boolean() },
  handler: async (ctx, args): Promise<InvalidateUsersResult> => {
    const userIds = normalizeUserIds(args.userIds);
    const users: UserInvalidationSummary[] = [];

    for (const userId of userIds) {
      const summary: UserInvalidationSummary = {
        userId,
        openRouterKeyPresent: false,
        openRouterKeyDeleted: false,
        oauthProviders: [],
        connections: [],
      };
      try {
        const found = await ctx.runQuery(
          internal.security.credential_invalidation.inspectUserCredentials,
          { userId },
        );
        summary.openRouterKeyPresent = found.openRouterKeyPresent;
        summary.oauthProviders = found.oauthProviders;
        if (!args.dryRun) {
          const key = await ctx.runMutation(
            internal.security.credential_invalidation.invalidateUserOpenRouterKey,
            { userId },
          );
          summary.openRouterKeyDeleted = key.deleted;
          summary.connections = await ctx.runAction(
            internal.security.credential_invalidation.revokeUserOAuthConnections,
            { userId },
          );
        }
      } catch {
        summary.error = "invalidation_failed";
      }
      users.push(summary);
    }

    const connections = users.flatMap((user) => user.connections);
    return {
      dryRun: args.dryRun,
      totals: {
        users: users.length,
        usersWithOpenRouterKey: users.filter((u) => u.openRouterKeyPresent).length,
        openRouterKeysDeleted: users.filter((u) => u.openRouterKeyDeleted).length,
        oauthConnectionsFound: users.reduce((n, u) => n + u.oauthProviders.length, 0),
        oauthConnectionsRevoked: connections.filter((c) => c.revoked).length,
        oauthConnectionsDeleted: connections.filter((c) => c.deleted).length,
        connectionsNeedingUserAction: connections.filter((c) => c.userActionRequired).length,
        failedUsers: users.filter((u) => u.error !== undefined).length,
      },
      users,
    };
  },
});
