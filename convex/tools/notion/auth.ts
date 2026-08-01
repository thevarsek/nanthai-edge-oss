// convex/tools/notion/auth.ts
// =============================================================================
// Notion OAuth token management for tool execution.
//
// Provides retrieval and refresh for user-scoped Notion OAuth tokens.
//
// Uses raw `fetch` — no Node.js SDK — so it works in Convex's
// default V8 runtime without "use node".
// =============================================================================

import { ConvexError } from "convex/values";
import { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  decryptOAuthCredentials,
  encryptOAuthCredentials,
} from "../../lib/secret_crypto";
import {
  getNotionOAuthClientConfig,
  NOTION_OAUTH_TOKEN_URL,
  notionOAuthHeaders,
} from "../../oauth/notion_oauth";

const FAR_FUTURE_EXPIRY_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const MAX_REFRESH_RETRIES = 2;

/** Shape of the stored oauthConnections row (as returned by getConnectionInternal). */
export interface StoredNotionConnection {
  _id: Id<"oauthConnections">;
  userId: string;
  provider: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  email?: string;
  displayName?: string;
  status: string;
  connectedAt: number;
  lastUsedAt?: number;
  errorMessage?: string;
  lastRefreshedAt?: number;
}

/**
 * Get a valid Notion access token for the given user.
 *
 * 1. Fetches the stored connection from Convex.
 * 2. Verifies the connection status is "active".
 * 3. Returns the access token string. API 401 responses trigger the refresh
 *    path in the shared Notion client.
 *
 * Throws if no connection exists or the connection is not active.
 */
export async function getNotionAccessToken(
  ctx: ActionCtx,
  userId: string,
): Promise<{ accessToken: string; connection: StoredNotionConnection }> {
  const connection = (await ctx.runQuery(
    internal.oauth.notion.getConnectionInternal,
    { userId },
  )) as StoredNotionConnection | null;

  if (!connection) {
    throw new ConvexError({
      code: "INTEGRATION_NOT_CONNECTED" as const,
      message: "No Notion account connected. Ask the user to connect Notion in Settings → Connected Accounts.",
    });
  }

  if (connection.status !== "active") {
    throw new ConvexError({
      code: "INTEGRATION_NOT_CONNECTED" as const,
      message: `Notion connection is ${connection.status}. Ask the user to reconnect Notion in Settings.`,
    });
  }

  const credentials = await decryptOAuthCredentials({
    userId,
    provider: "notion",
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
  });
  const decryptedConnection: StoredNotionConnection = { ...connection, ...credentials };
  return { accessToken: decryptedConnection.accessToken, connection: decryptedConnection };
}

export async function refreshNotionAccessToken(
  ctx: ActionCtx,
  userId: string,
): Promise<{ accessToken: string; connection: StoredNotionConnection }> {
  for (let attempt = 0; attempt <= MAX_REFRESH_RETRIES; attempt++) {
    const storedConnection = (await ctx.runQuery(
      internal.oauth.notion.getConnectionInternal,
      { userId },
    )) as StoredNotionConnection | null;

    if (!storedConnection || storedConnection.status !== "active") {
      throw new ConvexError({
        code: "INTEGRATION_NOT_CONNECTED" as const,
        message: "No active Notion connection. Reconnect Notion in Settings → Connected Accounts.",
      });
    }

    const credentials = await decryptOAuthCredentials({
      userId,
      provider: "notion",
      accessToken: storedConnection.accessToken,
      refreshToken: storedConnection.refreshToken,
    });
    if (!credentials.refreshToken) {
      throw new ConvexError({
        code: "TOKEN_REFRESH_FAILED" as const,
        message: "Notion authorization must be renewed. Reconnect Notion in Settings → Connected Accounts.",
      });
    }

    const clientConfig = getNotionOAuthClientConfig();
    const response = await fetch(NOTION_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: notionOAuthHeaders(clientConfig),
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
      }),
    });

    if (!response.ok) {
      const latestConnection = (await ctx.runQuery(
        internal.oauth.notion.getConnectionInternal,
        { userId },
      )) as StoredNotionConnection | null;
      if (
        latestConnection
        && latestConnection.status === "active"
        && (latestConnection.lastRefreshedAt ?? 0)
          !== (storedConnection.lastRefreshedAt ?? 0)
      ) {
        const latestCredentials = await decryptOAuthCredentials({
          userId,
          provider: "notion",
          accessToken: latestConnection.accessToken,
          refreshToken: latestConnection.refreshToken,
        });
        const connection = { ...latestConnection, ...latestCredentials };
        return { accessToken: connection.accessToken, connection };
      }

      await ctx.runMutation(internal.oauth.notion.markConnectionExpired, {
        userId,
        expectedConnectionId: storedConnection._id,
        expectedLastRefreshedAt: storedConnection.lastRefreshedAt ?? 0,
        errorMessage: `Token refresh failed (HTTP ${response.status})`,
      });
      throw new ConvexError({
        code: "TOKEN_REFRESH_FAILED" as const,
        message: "Notion authorization expired. Reconnect Notion in Settings → Connected Accounts.",
      });
    }

    const tokens = (await response.json()) as {
      access_token?: string;
      refresh_token?: string | null;
      expires_in?: number;
    };
    if (!tokens.access_token) {
      throw new ConvexError({
        code: "TOKEN_REFRESH_FAILED" as const,
        message: "Notion did not return a refreshed access token. Reconnect Notion in Settings → Connected Accounts.",
      });
    }

    const encrypted = await encryptOAuthCredentials({
      userId,
      provider: "notion",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? credentials.refreshToken,
    });
    const expiresAt = Number.isFinite(tokens.expires_in)
      ? Date.now() + Math.max(0, tokens.expires_in ?? 0) * 1000
      : Date.now() + FAR_FUTURE_EXPIRY_MS;
    await ctx.runMutation(internal.oauth.notion.upsertConnection, {
      userId,
      ...encrypted,
      expiresAt,
      scopes: storedConnection.scopes,
      email: storedConnection.email,
      displayName: storedConnection.displayName,
      expectedLastRefreshedAt: storedConnection.lastRefreshedAt ?? 0,
      expectedConnectionId: storedConnection._id,
    });

    const updated = (await ctx.runQuery(
      internal.oauth.notion.getConnectionInternal,
      { userId },
    )) as StoredNotionConnection | null;
    if (updated && (updated.lastRefreshedAt ?? 0) !== (storedConnection.lastRefreshedAt ?? 0)) {
      const updatedCredentials = await decryptOAuthCredentials({
        userId,
        provider: "notion",
        accessToken: updated.accessToken,
        refreshToken: updated.refreshToken,
      });
      const connection = { ...updated, ...updatedCredentials };
      return { accessToken: connection.accessToken, connection };
    }
  }

  throw new ConvexError({
    code: "TOKEN_REFRESH_FAILED" as const,
    message: "Notion token refresh conflicted with another request. Please try again.",
  });
}
