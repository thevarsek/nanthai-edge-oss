// convex/oauth/slack.ts
// =============================================================================
// Slack OAuth token exchange and connection management.
// Handles the server-side of the OAuth flow:
//   1. Client sends auth code (no PKCE — Slack uses client secret)
//   2. This action exchanges the code for a user access token
//   3. Token is stored in the oauthConnections table
//
// Slack user tokens (xoxp-*) do not expire by default (no token rotation).
// Token endpoint: POST https://slack.com/api/oauth.v2.user.access
// with form-encoded client_id, client_secret, code, redirect_uri.
// =============================================================================

import { v, ConvexError } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";

// ---------------------------------------------------------------------------
// Slack OAuth Constants
// ---------------------------------------------------------------------------

// https://docs.slack.dev/authentication/installing-with-oauth#the-user-centric-flow-the-oauthv2useraccess-method
// https://docs.slack.dev/ai/slack-mcp-server#oauth-url-and-endpoints
// User-token-only code exchange endpoint (no bot scopes).
const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.user.access";
const SLACK_AUTH_TEST_URL = "https://slack.com/api/auth.test";

// Slack user tokens may be long-lived, but token rotation can return
// expiring access tokens plus refresh tokens. Keep a far-future fallback
// only for installs that still receive non-rotating user tokens.
// Safe because auth.ts guards refresh with `!connection.refreshToken`,
// so this timestamp is never compared for non-rotating tokens.
const NON_EXPIRING_MS = 10 * 365 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// exchangeSlackCode — Action (needs network access for token exchange)
//
// Called by clients after the user completes the Slack consent screen.
// Exchanges the authorization code for a user token, then validates via
// auth.test to get user/team info.
// ---------------------------------------------------------------------------

export const exchangeSlackCode = action({
  args: {
    code: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new ConvexError({
        code: "CONFIG_ERROR",
        message:
          "Slack OAuth is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET environment variables.",
      });
    }

    // Slack uses form-encoded POST for token exchange
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: args.code,
      redirect_uri: args.redirectUri,
    });

    const tokenResponse = await fetch(SLACK_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Slack token exchange HTTP failed:", errorText);
      throw new ConvexError({
        code: "EXTERNAL_SERVICE",
        message: `Slack token exchange failed (HTTP ${tokenResponse.status})`,
      });
    }

    const result = (await tokenResponse.json()) as {
      ok: boolean;
      error?: string;
      access_token?: string;
      token_type?: string;
      scope?: string;
      expires_in?: number;
      refresh_token?: string;
      team?: { id?: string; name?: string };
      authed_user?: {
        id?: string;
        access_token?: string;
        token_type?: string;
        scope?: string;
        expires_in?: number;
        refresh_token?: string;
      };
    };

    // Slack's oauth.v2.user.access returns the user token in authed_user.access_token
    // (or at the top level for user-token-only flows)
    const accessToken =
      result.authed_user?.access_token ?? result.access_token;
    const refreshToken =
      result.authed_user?.refresh_token ?? result.refresh_token ?? "";

    if (!result.ok || !accessToken) {
      console.error("Slack token exchange failed:", result.error ?? "no token");
      throw new ConvexError({
        code: "EXTERNAL_SERVICE",
        message: `Slack token exchange failed: ${result.error ?? "no access token returned"}`,
      });
    }

    // Parse granted scopes
    const scopeString =
      result.authed_user?.scope ?? result.scope ?? "";
    const scopes = scopeString
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const expiresInSeconds =
      result.authed_user?.expires_in ?? result.expires_in;

    // Validate the token and get user/team info via auth.test
    let displayName: string | undefined;
    let teamId: string | undefined;
    let teamName: string | undefined;

    try {
      const authTestRes = await fetch(SLACK_AUTH_TEST_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
      const authTest = (await authTestRes.json()) as {
        ok: boolean;
        user_id?: string;
        user?: string;
        team_id?: string;
        team?: string;
      };
      if (authTest.ok) {
        displayName = authTest.user;
        teamId = authTest.team_id ?? result.team?.id;
        teamName = authTest.team ?? result.team?.name;
      }
    } catch {
      // Non-fatal — we still have the token
      teamId = result.team?.id;
      teamName = result.team?.name;
    }

    const expiresAt = typeof expiresInSeconds === "number" && Number.isFinite(expiresInSeconds)
      ? Date.now() + expiresInSeconds * 1000
      : Date.now() + NON_EXPIRING_MS;

    await ctx.runMutation(internal.oauth.slack.upsertConnection, {
      userId,
      accessToken,
      refreshToken,
      expiresAt,
      scopes,
      displayName,
      workspaceId: teamId,
      workspaceName: teamName,
      expectedLastRefreshedAt: undefined,
    });

    return {
      success: true,
      displayName: displayName ?? null,
      workspaceName: teamName ?? null,
    };
  },
});

// ---------------------------------------------------------------------------
// upsertConnection — Internal mutation to store/update Slack tokens
// ---------------------------------------------------------------------------

export const upsertConnection = internalMutation({
  args: {
    userId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    scopes: v.array(v.string()),
    displayName: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    workspaceName: v.optional(v.string()),
    expectedLastRefreshedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "slack"),
      )
      .unique();

    const now = Date.now();

    if (existing) {
      if (args.expectedLastRefreshedAt !== undefined) {
        const storedRefreshedAt = existing.lastRefreshedAt ?? 0;
        if (storedRefreshedAt !== args.expectedLastRefreshedAt) {
          return existing._id;
        }
      }

      await ctx.db.patch(existing._id, {
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        expiresAt: args.expiresAt,
        scopes: args.scopes,
        displayName: args.displayName,
        workspaceId: args.workspaceId,
        workspaceName: args.workspaceName,
        status: "active",
        errorMessage: undefined,
        lastRefreshedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("oauthConnections", {
      userId: args.userId,
      provider: "slack",
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      expiresAt: args.expiresAt,
      scopes: args.scopes,
      displayName: args.displayName,
      workspaceId: args.workspaceId,
      workspaceName: args.workspaceName,
      status: "active",
      connectedAt: now,
      lastRefreshedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// getSlackConnection — Public query for clients to check connection status
// ---------------------------------------------------------------------------

export const getSlackConnection = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const connection = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", userId).eq("provider", "slack"),
      )
      .unique();

    if (!connection) {
      return null;
    }

    return {
      id: connection._id,
      displayName: connection.displayName ?? null,
      workspaceId: connection.workspaceId ?? null,
      workspaceName: connection.workspaceName ?? null,
      status: connection.status,
      scopes: connection.scopes,
      connectedAt: connection.connectedAt,
      lastUsedAt: connection.lastUsedAt ?? null,
      errorMessage: connection.errorMessage ?? null,
    };
  },
});

// ---------------------------------------------------------------------------
// disconnectSlack — Revoke token and delete connection
// ---------------------------------------------------------------------------

export const disconnectSlack = action({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const connection = await ctx.runQuery(
      internal.oauth.slack.getConnectionInternal,
      { userId },
    );

    if (!connection) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "No Slack connection found.",
      });
    }

    // Try to revoke the token with Slack (best-effort)
    try {
      await fetch("https://slack.com/api/auth.revoke", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
    } catch {
      // Non-fatal — we still delete the local connection
    }

    await ctx.runMutation(internal.oauth.slack.deleteConnection, { userId });

    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// getConnectionInternal — Internal query (returns full record with tokens)
// ---------------------------------------------------------------------------

export const getConnectionInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "slack"),
      )
      .unique();
  },
});

// ---------------------------------------------------------------------------
// markConnectionExpired — Internal mutation to flag a connection as expired
// ---------------------------------------------------------------------------

export const markConnectionExpired = internalMutation({
  args: {
    userId: v.string(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "slack"),
      )
      .unique();

    if (connection) {
      await ctx.db.patch(connection._id, {
        status: "expired",
        errorMessage: args.errorMessage ?? "Token refresh failed",
      });
    }
  },
});

// ---------------------------------------------------------------------------
// deleteConnection — Internal mutation to remove a connection record
// ---------------------------------------------------------------------------

export const deleteConnection = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "slack"),
      )
      .unique();

    if (connection) {
      await ctx.db.delete(connection._id);
    }
  },
});
