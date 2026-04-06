// convex/oauth/microsoft.ts
// =============================================================================
// Microsoft OAuth token exchange and connection management.
// Handles the server-side of the PKCE OAuth flow:
//   1. iOS sends auth code + code verifier
//   2. This action exchanges them for access/refresh tokens with Microsoft
//   3. Tokens are stored in the oauthConnections table
//
// Microsoft uses the /common/ tenant for multi-tenant + personal accounts.
// The iOS app is a public/native client using PKCE — NO client_secret is
// sent in any token request (Microsoft rejects it with AADSTS90023).
// =============================================================================

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";

// ---------------------------------------------------------------------------
// Microsoft OAuth Constants
// ---------------------------------------------------------------------------

const MICROSOFT_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MICROSOFT_GRAPH_ME_URL = "https://graph.microsoft.com/v1.0/me";

// Microsoft doesn't have a single revoke endpoint like Google. To "revoke",
// we just delete the stored tokens. The user can also revoke via
// https://account.live.com/consent/Manage or Azure AD "My Apps".

// ---------------------------------------------------------------------------
// exchangeMicrosoftCode — Action (needs network access for token exchange)
//
// Called by iOS after the user completes the Microsoft consent screen.
// Exchanges the authorization code + PKCE verifier for tokens, then stores
// the connection in the oauthConnections table.
// ---------------------------------------------------------------------------

export const exchangeMicrosoftCode = action({
  args: {
    code: v.string(),
    codeVerifier: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) {
      throw new Error(
        "Microsoft OAuth is not configured. Set MICROSOFT_CLIENT_ID environment variable.",
      );
    }

    // Build token exchange params.
    // iOS public client uses PKCE (code_verifier). Public/native clients
    // must NOT send client_secret — Microsoft rejects with AADSTS90023.
    const tokenParams: Record<string, string> = {
      code: args.code,
      client_id: clientId,
      redirect_uri: args.redirectUri,
      grant_type: "authorization_code",
      code_verifier: args.codeVerifier,
    };

    const tokenResponse = await fetch(MICROSOFT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(tokenParams),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Microsoft token exchange failed:", errorText);
      throw new Error(
        `Microsoft token exchange failed (HTTP ${tokenResponse.status})`,
      );
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
      scope: string;
    };

    if (!tokens.access_token) {
      throw new Error("Microsoft did not return an access token.");
    }

    // Fetch user info (email, name) from Microsoft Graph
    let email: string | undefined;
    let displayName: string | undefined;
    try {
      const meResponse = await fetch(MICROSOFT_GRAPH_ME_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (meResponse.ok) {
        const me = (await meResponse.json()) as {
          mail?: string;
          userPrincipalName?: string;
          displayName?: string;
        };
        // `mail` may be null for personal accounts; fall back to UPN
        email = me.mail || me.userPrincipalName;
        displayName = me.displayName;
      }
    } catch {
      // Non-fatal — we can still store the connection without profile info
      console.warn("Failed to fetch Microsoft user info");
    }

    const expiresAt = Date.now() + tokens.expires_in * 1000;
    const scopes = tokens.scope ? tokens.scope.split(" ") : [];

    // Store or update the connection via internal mutation
    await ctx.runMutation(internal.oauth.microsoft.upsertConnection, {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? "",
      expiresAt,
      scopes,
      email,
      displayName,
    });

    return { success: true, email: email ?? null };
  },
});

// ---------------------------------------------------------------------------
// upsertConnection — Internal mutation to store/update Microsoft tokens
// ---------------------------------------------------------------------------

export const upsertConnection = internalMutation({
  args: {
    userId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    scopes: v.array(v.string()),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    // CAS guard: only apply this refresh if lastRefreshedAt hasn't changed
    // since the caller read the row. Prevents parallel refresh races (Bug H-2).
    expectedLastRefreshedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "microsoft"),
      )
      .unique();

    const now = Date.now();

    if (existing) {
      // CAS check: if another tool already refreshed since we read, skip.
      if (args.expectedLastRefreshedAt !== undefined) {
        const storedRefreshedAt = existing.lastRefreshedAt ?? 0;
        if (storedRefreshedAt !== args.expectedLastRefreshedAt) {
          // Another concurrent refresh already landed — return the existing
          // row ID without overwriting. The caller will re-read the fresh token.
          return existing._id;
        }
      }

      // Update existing connection
      const patch: Record<string, unknown> = {
        accessToken: args.accessToken,
        expiresAt: args.expiresAt,
        scopes: args.scopes,
        status: "active",
        errorMessage: undefined,
        lastRefreshedAt: now,
      };
      // Only overwrite refreshToken if Microsoft sent a new one
      if (args.refreshToken) {
        patch.refreshToken = args.refreshToken;
      }
      if (args.email) patch.email = args.email;
      if (args.displayName) patch.displayName = args.displayName;
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    } else {
      // Create new connection
      return await ctx.db.insert("oauthConnections", {
        userId: args.userId,
        provider: "microsoft",
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        expiresAt: args.expiresAt,
        scopes: args.scopes,
        email: args.email,
        displayName: args.displayName,
        status: "active",
        connectedAt: now,
        lastRefreshedAt: now,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// getMicrosoftConnection — Public query for iOS to check connection status
//
// Returns only metadata (email, status, scopes). Never exposes tokens.
// ---------------------------------------------------------------------------

export const getMicrosoftConnection = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const connection = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", userId).eq("provider", "microsoft"),
      )
      .unique();

    if (!connection) {
      return null;
    }

    // Never return tokens to the client — only metadata
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

// ---------------------------------------------------------------------------
// disconnectMicrosoft — Delete tokens from DB
//
// Microsoft doesn't have a simple token revoke endpoint like Google.
// We delete the stored connection. Users can revoke app access manually
// at https://account.live.com/consent/Manage or Azure AD portal.
// ---------------------------------------------------------------------------

export const disconnectMicrosoft = action({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const connection = await ctx.runQuery(
      internal.oauth.microsoft.getConnectionInternal,
      { userId },
    );

    if (!connection) {
      throw new Error("No Microsoft connection found.");
    }

    // Delete the connection from the database
    await ctx.runMutation(internal.oauth.microsoft.deleteConnection, {
      userId,
    });

    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// getConnectionInternal — Internal query (returns full record with tokens)
// Used by actions that need the access/refresh tokens for API calls.
// ---------------------------------------------------------------------------

export const getConnectionInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "microsoft"),
      )
      .unique();
  },
});

// ---------------------------------------------------------------------------
// markConnectionExpired — Internal mutation to flag a connection as expired
// Called when token refresh fails, so the iOS app can prompt reconnection.
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
        q.eq("userId", args.userId).eq("provider", "microsoft"),
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
        q.eq("userId", args.userId).eq("provider", "microsoft"),
      )
      .unique();

    if (connection) {
      await ctx.db.delete(connection._id);
    }
  },
});
