// convex/oauth/google.ts
// =============================================================================
// Google OAuth token exchange and connection management.
// Handles the server-side of the PKCE OAuth flow:
//   1. iOS sends auth code + code verifier
//   2. This action exchanges them for access/refresh tokens with Google
//   3. Tokens are stored in the oauthConnections table
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
import { resolveGoogleOAuthClientConfigForRedirect } from "./google_client_config";
import {
  deriveGoogleCapabilityFlags,
  googleScopesForIntegration,
  mergeGoogleScopes,
} from "./google_capabilities";
import { getGoogleAccessToken } from "../tools/google/auth";
import { fetchDriveMetadata } from "../drive_picker/ingest";

// ---------------------------------------------------------------------------
// Google OAuth Constants
// ---------------------------------------------------------------------------

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL =
  "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// ---------------------------------------------------------------------------
// exchangeGoogleCode — Action (needs network access for token exchange)
//
// Called by iOS after the user completes the Google consent screen.
// Exchanges the authorization code + PKCE verifier for tokens, then stores
// the connection in the oauthConnections table.
// ---------------------------------------------------------------------------

export const exchangeGoogleCode = action({
  args: {
    code: v.string(),
    codeVerifier: v.string(),
    redirectUri: v.string(),
    requestedIntegration: v.union(
      v.literal("base"),
      v.literal("gmail"),
      v.literal("drive"),
      v.literal("calendar"),
      v.literal("workspace"),
    ),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    if (args.requestedIntegration === "gmail") {
      throw new ConvexError({
        code: "GMAIL_MANUAL_REQUIRED",
        message: "Gmail is no longer connected through Google OAuth. Connect Manual Gmail with a Google app password.",
      });
    }
    const clientConfig = resolveGoogleOAuthClientConfigForRedirect(args.redirectUri);

    // Exchange authorization code for tokens.
    // Native clients use PKCE without a secret; web clients may also require a secret.
    const tokenParams: Record<string, string> = {
      code: args.code,
      client_id: clientConfig.clientId,
      redirect_uri: args.redirectUri,
      grant_type: "authorization_code",
      code_verifier: args.codeVerifier,
    };

    if (clientConfig.clientSecret) {
      tokenParams.client_secret = clientConfig.clientSecret;
    }

    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(tokenParams),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Google token exchange failed:", errorText);
      throw new ConvexError({ code: "EXTERNAL_SERVICE", message: `Google token exchange failed (HTTP ${tokenResponse.status})` });
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
      scope: string;
    };

    if (!tokens.access_token) {
      throw new ConvexError({ code: "EXTERNAL_SERVICE", message: "Google did not return an access token." });
    }

    // Fetch user info (email, name) using the access token
    let email: string | undefined;
    let displayName: string | undefined;
    try {
      const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userInfoResponse.ok) {
        const userInfo = (await userInfoResponse.json()) as {
          email?: string;
          name?: string;
        };
        email = userInfo.email;
        displayName = userInfo.name;
      }
    } catch {
      // Non-fatal — we can still store the connection without profile info
      console.warn("Failed to fetch Google user info");
    }

    const expiresAt = Date.now() + tokens.expires_in * 1000;
    const scopes = mergeGoogleScopes(
      [],
      tokens.scope ? tokens.scope.split(" ") : googleScopesForIntegration(args.requestedIntegration),
    );

    // Store or update the connection via internal mutation
    await ctx.runMutation(internal.oauth.google.upsertConnection, {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? "",
      expiresAt,
      scopes,
      email,
      displayName,
      clientType: clientConfig.clientType,
    });

    return { success: true, email: email ?? null };
  },
});

// ---------------------------------------------------------------------------
// upsertConnection — Internal mutation to store/update Google tokens
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
    clientType: v.optional(v.union(v.literal("native"), v.literal("web"))),
    // CAS guard: only apply this refresh if lastRefreshedAt hasn't changed
    // since the caller read the row. Prevents parallel refresh races (Bug H-2).
    expectedLastRefreshedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "google"),
      )
      .unique();

    const now = Date.now();

    if (existing) {
      // CAS check: if another tool already refreshed since we read, skip.
      // Compare the stored lastRefreshedAt against what the caller saw.
      if (args.expectedLastRefreshedAt !== undefined) {
        const storedRefreshedAt = existing.lastRefreshedAt ?? 0;
        if (storedRefreshedAt !== args.expectedLastRefreshedAt) {
          // Another concurrent refresh already landed — return the existing
          // row ID without overwriting. The caller will re-read the fresh token.
          return existing._id;
        }
      }

      const mergedScopes = mergeGoogleScopes(existing.scopes, args.scopes);

      // Update existing connection
      const patch: Record<string, unknown> = {
        accessToken: args.accessToken,
        expiresAt: args.expiresAt,
        scopes: mergedScopes,
        status: "active",
        errorMessage: undefined,
        lastRefreshedAt: now,
      };
      // Only overwrite refreshToken if Google sent a new one
      if (args.refreshToken) {
        patch.refreshToken = args.refreshToken;
      }
      if (args.email) patch.email = args.email;
      if (args.displayName) patch.displayName = args.displayName;
      if (args.clientType) patch.clientType = args.clientType;
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    } else {
      // Create new connection
      return await ctx.db.insert("oauthConnections", {
        userId: args.userId,
        provider: "google",
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        expiresAt: args.expiresAt,
        scopes: args.scopes,
        email: args.email,
        displayName: args.displayName,
        clientType: args.clientType,
        status: "active",
        connectedAt: now,
        lastRefreshedAt: now,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// getGoogleConnection — Public query for iOS to check connection status
//
// Returns only metadata (email, status, scopes). Never exposes tokens.
// ---------------------------------------------------------------------------

export const getGoogleConnection = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const connection = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", userId).eq("provider", "google"),
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
      ...deriveGoogleCapabilityFlags(connection.scopes),
      connectedAt: connection.connectedAt,
      lastUsedAt: connection.lastUsedAt ?? null,
      errorMessage: connection.errorMessage ?? null,
    };
  },
});

export const getDrivePickerAccessToken = action({
  args: {},
  handler: async (ctx): Promise<{ accessToken: string; expiresAt?: number }> => {
    const { userId } = await requireAuth(ctx);
    const { accessToken, connection } = await getGoogleAccessToken(ctx, userId, "drive");
    return {
      accessToken,
      expiresAt: connection.expiresAt ?? undefined,
    };
  },
});

export const recordDriveFileGrant = internalMutation({
  args: {
    userId: v.string(),
    fileId: v.string(),
    name: v.string(),
    mimeType: v.string(),
    webViewLink: v.optional(v.string()),
    size: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("googleDriveFileGrants")
      .withIndex("by_user_file", (q) =>
        q.eq("userId", args.userId).eq("fileId", args.fileId),
      )
      .unique();
    const now = Date.now();
    const patch = {
      name: args.name,
      mimeType: args.mimeType,
      webViewLink: args.webViewLink,
      size: args.size,
      lastUsedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("googleDriveFileGrants", {
      userId: args.userId,
      fileId: args.fileId,
      name: args.name,
      mimeType: args.mimeType,
      webViewLink: args.webViewLink,
      size: args.size,
      grantedAt: now,
      lastUsedAt: now,
    });
  },
});

export const recordDriveFileGrantCache = internalMutation({
  args: {
    userId: v.string(),
    fileId: v.string(),
    name: v.string(),
    mimeType: v.string(),
    webViewLink: v.optional(v.string()),
    size: v.optional(v.string()),
    cachedStorageId: v.id("_storage"),
    cachedModifiedTime: v.string(),
    cachedSizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("googleDriveFileGrants")
      .withIndex("by_user_file", (q) =>
        q.eq("userId", args.userId).eq("fileId", args.fileId),
      )
      .unique();
    const now = Date.now();
    // Do not delete the previous cache blob here. Chat messages and KB rows may
    // still point at that immutable snapshot until their own refresh path updates
    // them. Cleanup happens only when the owning row is deleted.
    const patch = {
      name: args.name,
      mimeType: args.mimeType,
      webViewLink: args.webViewLink,
      size: args.size,
      cachedStorageId: args.cachedStorageId,
      cachedModifiedTime: args.cachedModifiedTime,
      cachedSizeBytes: args.cachedSizeBytes,
      cachedAt: now,
      lastUsedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("googleDriveFileGrants", {
      userId: args.userId,
      fileId: args.fileId,
      name: args.name,
      mimeType: args.mimeType,
      webViewLink: args.webViewLink,
      size: args.size,
      cachedStorageId: args.cachedStorageId,
      cachedModifiedTime: args.cachedModifiedTime,
      cachedSizeBytes: args.cachedSizeBytes,
      cachedAt: now,
      grantedAt: now,
      lastUsedAt: now,
    });
  },
});

export const getDriveFileGrantInternal = internalQuery({
  args: {
    userId: v.string(),
    fileId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("googleDriveFileGrants")
      .withIndex("by_user_file", (q) =>
        q.eq("userId", args.userId).eq("fileId", args.fileId),
      )
      .unique();
  },
});

export const listDriveFileGrantsInternal = internalQuery({
  args: {
    userId: v.string(),
    maxResults: v.number(),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("googleDriveFileGrants")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(Math.min(args.maxResults, 50));
    const query = args.query?.trim().toLowerCase();
    if (!query) return { rows, totalGrantCount: rows.length };
    const filtered = rows.filter((row) => row.name.toLowerCase().includes(query));
    return {
      rows: filtered,
      totalGrantCount: rows.length,
      matchedGrantCount: filtered.length,
    };
  },
});

export const touchDriveFileGrantInternal = internalMutation({
  args: {
    userId: v.string(),
    fileId: v.string(),
  },
  handler: async (ctx, args) => {
    const grant = await ctx.db
      .query("googleDriveFileGrants")
      .withIndex("by_user_file", (q) =>
        q.eq("userId", args.userId).eq("fileId", args.fileId),
      )
      .unique();
    if (grant) {
      await ctx.db.patch(grant._id, { lastUsedAt: Date.now() });
    }
  },
});

export const addDriveFileGrant = action({
  args: {
    fileId: v.string(),
    name: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    webViewLink: v.optional(v.string()),
    size: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const fileId = args.fileId.trim();
    if (!fileId) {
      throw new ConvexError({ code: "VALIDATION", message: "Drive fileId is required." });
    }
    const { accessToken } = await getGoogleAccessToken(ctx, userId, "drive");
    const meta = await fetchDriveMetadata(accessToken, fileId);
    await ctx.runMutation(internal.oauth.google.recordDriveFileGrant, {
      userId,
      fileId: meta.id,
      name: meta.name,
      mimeType: meta.mimeType,
      webViewLink: meta.webViewLink,
      size: meta.size,
    });
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// disconnectGoogle — Revoke tokens with Google and delete from DB
// ---------------------------------------------------------------------------

export const disconnectGoogle = action({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    // Fetch the connection to get the token for revocation
    const connection = await ctx.runQuery(
      internal.oauth.google.getConnectionInternal,
      { userId },
    );

    if (!connection) {
      throw new ConvexError({ code: "NOT_FOUND", message: "No Google connection found." });
    }

    // Attempt to revoke the token with Google (best-effort)
    try {
      await fetch(
        `${GOOGLE_REVOKE_URL}?token=${connection.refreshToken || connection.accessToken}`,
        { method: "POST" },
      );
    } catch {
      console.warn("Google token revocation failed (non-fatal)");
    }

    await ctx.runMutation(internal.oauth.google.deleteDriveFileGrantsForUser, {
      userId,
    });

    // Delete the connection from the database
    await ctx.runMutation(internal.oauth.google.deleteConnection, {
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
        q.eq("userId", args.userId).eq("provider", "google"),
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
        q.eq("userId", args.userId).eq("provider", "google"),
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
        q.eq("userId", args.userId).eq("provider", "google"),
      )
      .unique();

    if (connection) {
      await ctx.db.delete(connection._id);
    }
  },
});

export const deleteDriveFileGrantsForUser = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("googleDriveFileGrants")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const row of rows) {
      if (row.cachedStorageId) {
        const attachment = await ctx.db
          .query("fileAttachments")
          .withIndex("by_storage", (q) => q.eq("storageId", row.cachedStorageId!))
          .first();
        if (!attachment) {
          try {
            await ctx.storage.delete(row.cachedStorageId);
          } catch {
            // Storage blob may already be gone.
          }
        }
      }
      await ctx.db.delete(row._id);
    }
    return { deleted: rows.length };
  },
});
