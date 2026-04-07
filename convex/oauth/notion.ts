// convex/oauth/notion.ts
// =============================================================================
// Notion OAuth token exchange and connection management.
// Handles the server-side of the OAuth flow:
//   1. iOS sends auth code (no PKCE — Notion uses client secret)
//   2. This action exchanges the code for access/refresh tokens with Notion
//   3. Tokens are stored in the oauthConnections table
//
// Notion uses HTTP Basic Auth (base64 of client_id:client_secret) for the
// token endpoint, NOT form-encoded client credentials.
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
// Notion OAuth Constants
// ---------------------------------------------------------------------------

const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";

// ---------------------------------------------------------------------------
// exchangeNotionCode — Action (needs network access for token exchange)
//
// Called by iOS after the user completes the Notion consent screen.
// Exchanges the authorization code for tokens using HTTP Basic Auth,
// then stores the connection in the oauthConnections table.
// ---------------------------------------------------------------------------

export const exchangeNotionCode = action({
  args: {
    code: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const clientId = process.env.NOTION_CLIENT_ID;
    const clientSecret = process.env.NOTION_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new ConvexError({ code: "CONFIG_ERROR", message: "Notion OAuth is not configured. Set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET environment variables." });
    }

    // Notion uses HTTP Basic Auth: base64(client_id:client_secret)
    const encoded = btoa(`${clientId}:${clientSecret}`);

    const tokenResponse = await fetch(NOTION_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${encoded}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: args.code,
        redirect_uri: args.redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Notion token exchange failed:", errorText);
      throw new ConvexError({ code: "EXTERNAL_SERVICE", message: `Notion token exchange failed (HTTP ${tokenResponse.status})` });
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type: string;
      bot_id: string;
      workspace_id: string;
      workspace_name?: string;
      workspace_icon?: string;
      owner?: {
        type: string;
        user?: {
          id: string;
          name?: string;
          person?: { email?: string };
        };
      };
    };

    if (!tokens.access_token) {
      throw new ConvexError({ code: "EXTERNAL_SERVICE", message: "Notion did not return an access token." });
    }

    // Extract user info from the token response (Notion includes it directly)
    let email: string | undefined;
    let displayName: string | undefined;
    if (tokens.owner?.type === "user" && tokens.owner.user) {
      displayName = tokens.owner.user.name ?? undefined;
      email = tokens.owner.user.person?.email ?? undefined;
    }

    // Notion access tokens do NOT expire — there is no refresh_token grant type.
    // Set a far-future expiry so the token is never treated as "expired" by
    // shared infrastructure that checks expiresAt. The auth helper in
    // convex/tools/notion/auth.ts skips refresh entirely for Notion.
    const expiresAt = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000; // ~10 years

    // Store or update the connection via internal mutation
    await ctx.runMutation(internal.oauth.notion.upsertConnection, {
      userId,
      accessToken: tokens.access_token,
      refreshToken: "", // Notion does not issue refresh tokens
      expiresAt,
      scopes: [], // Notion doesn't use scopes — access is page-level
      email,
      displayName,
      workspaceId: tokens.workspace_id,
      workspaceName: tokens.workspace_name,
    });

    return {
      success: true,
      email: email ?? null,
      workspaceName: tokens.workspace_name ?? null,
    };
  },
});

// ---------------------------------------------------------------------------
// upsertConnection — Internal mutation to store/update Notion tokens
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
    workspaceId: v.optional(v.string()),
    workspaceName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "notion"),
      )
      .unique();

    const now = Date.now();

    if (existing) {
      // Update existing connection
      const patch: Record<string, unknown> = {
        accessToken: args.accessToken,
        expiresAt: args.expiresAt,
        scopes: args.scopes,
        status: "active",
        errorMessage: undefined,
      };
      // Only overwrite refreshToken if Notion sent a new one
      if (args.refreshToken) {
        patch.refreshToken = args.refreshToken;
      }
      if (args.email) patch.email = args.email;
      if (args.displayName) patch.displayName = args.displayName;
      if (args.workspaceId) patch.workspaceId = args.workspaceId;
      if (args.workspaceName) patch.workspaceName = args.workspaceName;
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    } else {
      // Create new connection
      return await ctx.db.insert("oauthConnections", {
        userId: args.userId,
        provider: "notion",
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        expiresAt: args.expiresAt,
        scopes: args.scopes,
        email: args.email,
        displayName: args.displayName,
        workspaceId: args.workspaceId,
        workspaceName: args.workspaceName,
        status: "active",
        connectedAt: now,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// getNotionConnection — Public query for iOS to check connection status
//
// Returns only metadata (email, status, workspace). Never exposes tokens.
// ---------------------------------------------------------------------------

export const getNotionConnection = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const connection = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", userId).eq("provider", "notion"),
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
// disconnectNotion — Delete tokens from DB
//
// Notion doesn't have a token revoke endpoint. We delete the stored
// connection. Users can revoke app access from Notion Settings →
// My connections.
// ---------------------------------------------------------------------------

export const disconnectNotion = action({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const connection = await ctx.runQuery(
      internal.oauth.notion.getConnectionInternal,
      { userId },
    );

    if (!connection) {
      throw new ConvexError({ code: "NOT_FOUND", message: "No Notion connection found." });
    }

    // Delete the connection from the database
    await ctx.runMutation(internal.oauth.notion.deleteConnection, {
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
        q.eq("userId", args.userId).eq("provider", "notion"),
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
        q.eq("userId", args.userId).eq("provider", "notion"),
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
        q.eq("userId", args.userId).eq("provider", "notion"),
      )
      .unique();

    if (connection) {
      await ctx.db.delete(connection._id);
    }
  },
});
