// convex/tools/cloze/auth.ts
// =============================================================================
// Cloze token management for tool execution.
//
// Provides `getClozeAccessToken()` which retrieves the stored connection and
// returns a bearer token for Cloze API calls.
//
// API KEYS: Cloze API keys do not expire. The token issued in Cloze Settings
// → Accounts and Services → API Key remains valid until the user revokes it.
//
// OAUTH2 (future): Cloze also supports OAuth2 with access+refresh tokens.
// When we add OAuth2, this helper is the only place that needs a refresh
// branch. We distinguish API-key connections from OAuth2 connections by
// inspecting the `scopes` array (API-key connections carry the `"api_key"`
// marker written by `connectCloze`).
//
// Callers use `connection.accessToken` exactly as today — the bearer header
// format is identical for both auth methods.
// =============================================================================

import { ConvexError } from "convex/values";
import { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";

/** Shape of the stored oauthConnections row (as returned by getConnectionInternal). */
export interface StoredClozeConnection {
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

const API_KEY_SCOPE_MARKER = "api_key";

/** True when the stored connection is an API key (vs OAuth2 access token). */
export function isApiKeyConnection(
  connection: StoredClozeConnection,
): boolean {
  return connection.scopes.includes(API_KEY_SCOPE_MARKER);
}

/**
 * Get a valid Cloze bearer token for the given user.
 *
 * Flow:
 * 1. Fetch the stored connection.
 * 2. Verify status is "active".
 * 3. For API-key connections (current default): return the stored token.
 * 4. For OAuth2 connections (future): if expiring soon, refresh first.
 *
 * Throws `INTEGRATION_NOT_CONNECTED` if no connection exists or the
 * connection is not active. Callers should catch and ask the user to
 * reconnect Cloze in Settings.
 */
export async function getClozeAccessToken(
  ctx: ActionCtx,
  userId: string,
): Promise<{ accessToken: string; connection: StoredClozeConnection }> {
  const connection = (await ctx.runQuery(
    internal.oauth.cloze.getConnectionInternal,
    { userId },
  )) as StoredClozeConnection | null;

  if (!connection) {
    throw new ConvexError({
      code: "INTEGRATION_NOT_CONNECTED" as const,
      message:
        "No Cloze account connected. Ask the user to connect Cloze in Settings → Connected Accounts.",
    });
  }

  if (connection.status !== "active") {
    throw new ConvexError({
      code: "INTEGRATION_NOT_CONNECTED" as const,
      message: `Cloze connection is ${connection.status}. Ask the user to reconnect Cloze in Settings.`,
    });
  }

  // API-key connections never expire and have no refresh endpoint.
  if (isApiKeyConnection(connection)) {
    return { accessToken: connection.accessToken, connection };
  }

  // OAuth2 branch — reserved for the future OAuth2 swap. When we ship it,
  // add a `refreshClozeAccessToken()` call here that inspects
  // `connection.expiresAt` and trades the refresh token at
  // https://www.cloze.com/oauth/token. Until then, treat any non-api_key
  // connection as a bug.
  throw new ConvexError({
    code: "INTEGRATION_NOT_CONNECTED" as const,
    message:
      "Cloze OAuth2 connections are not yet supported. Ask the user to reconnect Cloze with an API key.",
  });
}
