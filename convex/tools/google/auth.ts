// convex/tools/google/auth.ts
// =============================================================================
// Google OAuth token management for tool execution.
//
// Provides `getGoogleAccessToken()` which retrieves the stored connection,
// auto-refreshes expired tokens via Google's token endpoint, and returns
// a valid access token ready for API calls.
//
// Includes a compare-and-swap (CAS) guard on `lastRefreshedAt` so that
// parallel tool executions don't race on token refresh — the first writer
// wins and the losers re-read the already-refreshed token (Bug H-2).
//
// Uses raw `fetch` — no Node.js googleapis SDK — so it works in Convex's
// default V8 runtime without "use node".
// =============================================================================

import { ConvexError } from "convex/values";
import { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { resolveStoredGoogleOAuthClientConfig } from "../../oauth/google_client_config";
import { deriveGoogleCapabilityFlags } from "../../oauth/google_capabilities";
import type { ToolResult } from "../registry";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

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
export interface StoredGoogleConnection {
  _id: string;
  userId: string;
  provider: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  email?: string;
  displayName?: string;
  clientType?: string;
  status: string;
  connectedAt: number;
  lastUsedAt?: number;
  errorMessage?: string;
  lastRefreshedAt?: number;
}

export class MissingGoogleCapabilityError extends Error {
  readonly integrationId: "gmail" | "drive" | "calendar";

  constructor(integrationId: "gmail" | "drive" | "calendar") {
    super(
      `Google ${integrationId} access is not granted. Ask the user to enable ${integrationId} and complete Google consent.`,
    );
    this.integrationId = integrationId;
  }
}

export function googleCapabilityToolError(error: unknown): ToolResult | null {
  if (!(error instanceof MissingGoogleCapabilityError)) {
    return null;
  }
  return {
    success: false,
    data: {
      requiresGoogleCapability: true,
      integrationId: error.integrationId,
    },
    error: error.message,
  };
}

export function assertGoogleCapabilityGranted(
  connection: Pick<StoredGoogleConnection, "scopes">,
  integrationId?: "gmail" | "drive" | "calendar",
): void {
  if (!integrationId) return;
  const flags = deriveGoogleCapabilityFlags(connection.scopes);
  const hasCapability = integrationId === "gmail"
    ? flags.hasGmail
    : integrationId === "drive"
      ? flags.hasDrive
      : flags.hasCalendar;
  if (!hasCapability) {
    throw new MissingGoogleCapabilityError(integrationId);
  }
}

/**
 * Get a valid Google access token for the given user.
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
export async function getGoogleAccessToken(
  ctx: ActionCtx,
  userId: string,
  requiredIntegration?: "gmail" | "drive" | "calendar",
): Promise<{ accessToken: string; connection: StoredGoogleConnection }> {
  // Allow retries so that if our CAS write is beaten by a concurrent
  // refresh, we can re-read and return the winner's fresh token.
  for (let attempt = 0; attempt <= MAX_REFRESH_RETRIES; attempt++) {
    const connection = (await ctx.runQuery(
      internal.oauth.google.getConnectionInternal,
      { userId },
    )) as StoredGoogleConnection | null;

    if (!connection) {
      throw new ConvexError({
        code: "INTEGRATION_NOT_CONNECTED" as const,
        message: "No Google account connected. Ask the user to connect Google in Settings → Connected Accounts.",
      });
    }

    if (connection.status !== "active") {
      throw new ConvexError({
        code: "INTEGRATION_NOT_CONNECTED" as const,
        message: `Google connection is ${connection.status}. Ask the user to reconnect Google in Settings.`,
      });
    }

    assertGoogleCapabilityGranted(connection, requiredIntegration);

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
      throw new ConvexError({
        code: "TOKEN_REFRESH_FAILED" as const,
        message: "Google access token expired and no refresh token available. Ask the user to reconnect Google.",
      });
    }

    const clientConfig = resolveStoredGoogleOAuthClientConfig(connection.clientType);

    const refreshParams: Record<string, string> = {
      client_id: clientConfig.clientId,
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
    };

    if (clientConfig.clientSecret) {
      refreshParams.client_secret = clientConfig.clientSecret;
    }

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(refreshParams),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google token refresh failed:", errorText);

      // Mark connection as expired so iOS can prompt reconnection
      await ctx.runMutation(internal.oauth.google.markConnectionExpired, {
        userId,
        errorMessage: `Token refresh failed (HTTP ${response.status})`,
      });

      throw new ConvexError({
        code: "TOKEN_REFRESH_FAILED" as const,
        message: `Google token refresh failed (HTTP ${response.status}). Ask the user to reconnect Google.`,
      });
    }

    const tokens = (await response.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
      scope?: string;
    };

    const newExpiresAt = now + tokens.expires_in * 1000;

    // Persist the refreshed token with CAS guard.
    // Pass `expectedLastRefreshedAt` so that if another tool already wrote
    // a newer refresh, the mutation skips our write (no-op) and we re-read.
    await ctx.runMutation(internal.oauth.google.upsertConnection, {
      userId,
      accessToken: tokens.access_token,
      refreshToken: connection.refreshToken, // Google doesn't rotate refresh tokens
      expiresAt: newExpiresAt,
      scopes: connection.scopes,
      email: connection.email,
      displayName: connection.displayName,
      clientType: connection.clientType === "web" ? "web" : "native",
      expectedLastRefreshedAt: lastRefreshed,
    });

    // Re-read to confirm our write landed (or pick up the winner's token).
    const updated = (await ctx.runQuery(
      internal.oauth.google.getConnectionInternal,
      { userId },
    )) as StoredGoogleConnection | null;

    if (updated && updated.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
      assertGoogleCapabilityGranted(updated, requiredIntegration);
      // Either our write landed or another tool's refresh is already stored.
      return {
        accessToken: updated.accessToken,
        connection: updated,
      };
    }

    // Our CAS was beaten and the stored token is still stale — retry.
    console.warn(
      `Google token refresh CAS miss (attempt ${attempt + 1}/${MAX_REFRESH_RETRIES + 1}), retrying…`,
    );
  }

  // Exhausted retries — should be extremely rare.
  throw new ConvexError({
    code: "TOKEN_REFRESH_FAILED" as const,
    message: "Failed to refresh Google token after multiple attempts. Ask the user to reconnect Google.",
  });
}
