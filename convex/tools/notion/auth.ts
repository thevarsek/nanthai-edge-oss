// convex/tools/notion/auth.ts
// =============================================================================
// Notion OAuth token management for tool execution.
//
// Provides `getNotionAccessToken()` which retrieves the stored connection
// and returns the access token for Notion API calls.
//
// IMPORTANT: Notion access tokens do NOT expire and Notion does not support
// token refresh (there is no refresh_token grant type). The token issued
// during the initial OAuth code exchange remains valid indefinitely.
// If an API call fails with 401, the tool should surface a "reconnect"
// prompt — the auth helper does not attempt refresh.
//
// Uses raw `fetch` — no Node.js SDK — so it works in Convex's
// default V8 runtime without "use node".
// =============================================================================

import { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";

/** Shape of the stored oauthConnections row (as returned by getConnectionInternal). */
export interface StoredNotionConnection {
  _id: string;
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
}

/**
 * Get a valid Notion access token for the given user.
 *
 * 1. Fetches the stored connection from Convex.
 * 2. Verifies the connection status is "active".
 * 3. Returns the access token string.
 *
 * Notion tokens do not expire, so no refresh is performed.
 * If an API call later returns 401, the calling tool should use
 * `markConnectionExpired` and prompt the user to reconnect.
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
    throw new Error(
      "No Notion account connected. Ask the user to connect Notion in Settings → Connected Accounts.",
    );
  }

  if (connection.status !== "active") {
    throw new Error(
      `Notion connection is ${connection.status}. Ask the user to reconnect Notion in Settings.`,
    );
  }

  // Notion access tokens do not expire — return directly.
  return { accessToken: connection.accessToken, connection };
}
