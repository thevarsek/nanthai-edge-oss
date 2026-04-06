// convex/tools/microsoft/auth.ts
// =============================================================================
// Microsoft OAuth token management for tool execution.
//
// Provides `getMicrosoftAccessToken()` which retrieves the stored connection,
// auto-refreshes expired tokens via Microsoft's token endpoint, and returns
// a valid access token ready for Microsoft Graph API calls.
//
// Includes a compare-and-swap (CAS) guard on `lastRefreshedAt` so that
// parallel tool executions don't race on token refresh — the first writer
// wins and the losers re-read the already-refreshed token (Bug H-2).
// This is especially critical for Microsoft because the provider may rotate
// refresh tokens — a lost race could revoke the only valid refresh token.
//
// Uses raw `fetch` — no Node.js SDK — so it works in Convex's
// default V8 runtime without "use node".
// =============================================================================

import { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";

const MICROSOFT_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";

/** Minimum remaining lifetime before we proactively refresh (5 minutes). */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * If another tool refreshed the token within this window, skip the refresh
 * and just re-read the stored token. This avoids hitting the provider when
 * we can see the token was *just* refreshed by a concurrent execution.
 */
const RECENT_REFRESH_WINDOW_MS = 10 * 1000;

/** Maximum number of CAS retry attempts before giving up. */
const MAX_REFRESH_RETRIES = 2;

/** Shape of the stored oauthConnections row (as returned by getConnectionInternal). */
export interface StoredMicrosoftConnection {
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
  lastRefreshedAt?: number;
}

/**
 * Get a valid Microsoft access token for the given user.
 *
 * 1. Fetches the stored connection from Convex.
 * 2. If the token is expired (or about to expire), refreshes it.
 *    - Uses a CAS guard (`lastRefreshedAt`) to prevent parallel refresh races.
 *    - If another concurrent tool already refreshed the token, re-reads it
 *      instead of issuing a duplicate refresh request.
 * 3. Returns the access token string.
 *
 * Throws if no connection exists or refresh fails.
 */
export async function getMicrosoftAccessToken(
  ctx: ActionCtx,
  userId: string,
): Promise<{ accessToken: string; connection: StoredMicrosoftConnection }> {
  // Allow retries so that if our CAS write is beaten by a concurrent
  // refresh, we can re-read and return the winner's fresh token.
  for (let attempt = 0; attempt <= MAX_REFRESH_RETRIES; attempt++) {
    const connection = (await ctx.runQuery(
      internal.oauth.microsoft.getConnectionInternal,
      { userId },
    )) as StoredMicrosoftConnection | null;

    if (!connection) {
      throw new Error(
        "No Microsoft account connected. Ask the user to connect Microsoft in Settings → Connected Accounts.",
      );
    }

    if (connection.status !== "active") {
      throw new Error(
        `Microsoft connection is ${connection.status}. Ask the user to reconnect Microsoft in Settings.`,
      );
    }

    // Check if access token needs refresh
    const now = Date.now();
    if (connection.expiresAt - now > REFRESH_BUFFER_MS) {
      // Token is still valid
      return { accessToken: connection.accessToken, connection };
    }

    // -----------------------------------------------------------------------
    // Token expired or expiring soon.
    // Before calling the provider, check if another concurrent tool *just*
    // refreshed the token (within the last RECENT_REFRESH_WINDOW_MS).
    // If so, re-read — the stored accessToken should already be fresh.
    // -----------------------------------------------------------------------
    const lastRefreshed = connection.lastRefreshedAt ?? 0;
    if (now - lastRefreshed < RECENT_REFRESH_WINDOW_MS && attempt > 0) {
      // Another tool beat us to the refresh — the stored token should be
      // valid. If expiresAt is still in the past after re-reading, we'll
      // fall through to the actual refresh on the next iteration.
      return { accessToken: connection.accessToken, connection };
    }

    // Token expired or expiring soon — refresh it
    if (!connection.refreshToken) {
      throw new Error(
        "Microsoft access token expired and no refresh token available. Ask the user to reconnect Microsoft.",
      );
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) {
      throw new Error("MICROSOFT_CLIENT_ID environment variable not set.");
    }

    // Public/native clients must NOT send client_secret — Microsoft rejects
    // with AADSTS90023. Only client_id + refresh_token + grant_type are needed.
    const refreshParams: Record<string, string> = {
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
    };

    const response = await fetch(MICROSOFT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(refreshParams),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Microsoft token refresh failed:", errorText);

      // Mark connection as expired so iOS can prompt reconnection
      await ctx.runMutation(internal.oauth.microsoft.markConnectionExpired, {
        userId,
        errorMessage: `Token refresh failed (HTTP ${response.status})`,
      });

      throw new Error(
        `Microsoft token refresh failed (HTTP ${response.status}). Ask the user to reconnect Microsoft.`,
      );
    }

    const tokens = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
      scope?: string;
    };

    const newExpiresAt = now + tokens.expires_in * 1000;

    // Microsoft may rotate refresh tokens — use the new one if provided
    const newRefreshToken = tokens.refresh_token || connection.refreshToken;

    // Persist the refreshed token with CAS guard.
    // Pass `expectedLastRefreshedAt` so that if another tool already wrote
    // a newer refresh, the mutation skips our write (no-op) and we re-read.
    await ctx.runMutation(internal.oauth.microsoft.upsertConnection, {
      userId,
      accessToken: tokens.access_token,
      refreshToken: newRefreshToken,
      expiresAt: newExpiresAt,
      scopes: connection.scopes,
      email: connection.email,
      displayName: connection.displayName,
      expectedLastRefreshedAt: lastRefreshed,
    });

    // Re-read to confirm our write landed (or pick up the winner's token).
    const updated = (await ctx.runQuery(
      internal.oauth.microsoft.getConnectionInternal,
      { userId },
    )) as StoredMicrosoftConnection | null;

    if (updated && updated.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
      // Either our write landed or another tool's refresh is already stored.
      return {
        accessToken: updated.accessToken,
        connection: updated,
      };
    }

    // Our CAS was beaten and the stored token is still stale — retry.
    console.warn(
      `Microsoft token refresh CAS miss (attempt ${attempt + 1}/${MAX_REFRESH_RETRIES + 1}), retrying…`,
    );
  }

  // Exhausted retries — should be extremely rare.
  throw new Error(
    "Failed to refresh Microsoft token after multiple attempts. Ask the user to reconnect Microsoft.",
  );
}
