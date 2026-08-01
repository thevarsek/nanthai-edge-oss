// convex/tools/slack/auth.ts
// =============================================================================
// Slack token management for tool execution.
//
// Provides `getSlackAccessToken()` which retrieves the stored connection
// and returns the user token for Slack MCP calls.
//
// Slack user tokens (xoxp-*) do not expire by default. If a call fails
// with an auth error, the tool should surface a "reconnect" prompt.
// =============================================================================

import { ConvexError } from "convex/values";
import { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  decryptOAuthCredentials,
  encryptOAuthCredentials,
} from "../../lib/secret_crypto";

// Initial code exchange uses oauth.v2.user.access (in convex/oauth/slack.ts).
// Token refresh uses oauth.v2.access per Slack's token rotation docs:
// https://docs.slack.dev/authentication/using-token-rotation#refresh-a-token
// https://api.slack.com/methods/oauth.v2.access
const SLACK_TOKEN_REFRESH_URL = "https://slack.com/api/oauth.v2.access";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const RECENT_REFRESH_WINDOW_MS = 30 * 1000;
const MAX_REFRESH_RETRIES = 2;

/** Shape of the stored oauthConnections row. */
export interface StoredSlackConnection {
  _id: Id<"oauthConnections">;
  userId: string;
  provider: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  displayName?: string;
  workspaceId?: string;
  workspaceName?: string;
  status: string;
  connectedAt: number;
  lastUsedAt?: number;
  errorMessage?: string;
  lastRefreshedAt?: number;
}

/**
 * Get a valid Slack access token for the given user.
 *
 * Slack user tokens do not expire, so no refresh is performed.
 * If an MCP call later returns an auth error, the calling tool should
 * use `markConnectionExpired` and prompt the user to reconnect.
 */
export async function getSlackAccessToken(
  ctx: ActionCtx,
  userId: string,
): Promise<{ accessToken: string; connection: StoredSlackConnection }> {
  for (let attempt = 0; attempt <= MAX_REFRESH_RETRIES; attempt++) {
    const storedConnection = (await ctx.runQuery(
      internal.oauth.slack.getConnectionInternal,
      { userId },
    )) as StoredSlackConnection | null;

    if (!storedConnection) {
      throw new ConvexError({
        code: "INTEGRATION_NOT_CONNECTED" as const,
        message:
          "No Slack account connected. Ask the user to connect Slack in Settings → Connected Accounts.",
      });
    }

    if (storedConnection.status !== "active") {
      throw new ConvexError({
        code: "INTEGRATION_NOT_CONNECTED" as const,
        message: `Slack connection is ${storedConnection.status}. Ask the user to reconnect Slack in Settings.`,
      });
    }
    const credentials = await decryptOAuthCredentials({
      userId,
      provider: "slack",
      accessToken: storedConnection.accessToken,
      refreshToken: storedConnection.refreshToken,
    });
    const connection: StoredSlackConnection = { ...storedConnection, ...credentials };

    const now = Date.now();
    if (!connection.refreshToken || connection.expiresAt - now > REFRESH_BUFFER_MS) {
      return { accessToken: connection.accessToken, connection };
    }

    const lastRefreshed = connection.lastRefreshedAt ?? 0;
    if (now - lastRefreshed < RECENT_REFRESH_WINDOW_MS) {
      // Another caller refreshed very recently — trust the stored token.
      return { accessToken: connection.accessToken, connection };
    }

    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new ConvexError({
        code: "MISSING_CONFIG" as const,
        message: "Slack OAuth is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.",
      });
    }

    const response = await fetch(SLACK_TOKEN_REFRESH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: connection.refreshToken,
      }),
    });

    const result = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      scope?: string;
      authed_user?: {
        access_token?: string;
        expires_in?: number;
        refresh_token?: string;
        scope?: string;
      };
    };

    const refreshedAccessToken =
      result.authed_user?.access_token ?? result.access_token;
    const refreshedRefreshToken =
      result.authed_user?.refresh_token ?? result.refresh_token;
    const refreshedExpiresIn =
      result.authed_user?.expires_in ?? result.expires_in;

    if (
      !response.ok ||
      result.ok !== true ||
      !refreshedAccessToken ||
      !refreshedRefreshToken ||
      typeof refreshedExpiresIn !== "number"
    ) {
      await ctx.runMutation(internal.oauth.slack.markConnectionExpired, {
        userId,
        expectedConnectionId: storedConnection._id,
        expectedLastRefreshedAt: lastRefreshed,
        errorMessage: response.ok
          ? "Token refresh failed"
          : `Token refresh failed (HTTP ${response.status})`,
      });
      throw new ConvexError({
        code: "TOKEN_REFRESH_FAILED" as const,
        message: "Slack access token expired and refresh failed. Ask the user to reconnect Slack.",
      });
    }

    const scopes = (result.authed_user?.scope ?? result.scope ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);

    const encrypted = await encryptOAuthCredentials({
      userId,
      accessToken: refreshedAccessToken,
      refreshToken: refreshedRefreshToken,
      provider: "slack",
    });
    await ctx.runMutation(internal.oauth.slack.upsertConnection, {
      userId,
      ...encrypted,
      expiresAt: now + refreshedExpiresIn * 1000,
      scopes: scopes.length > 0 ? scopes : connection.scopes,
      displayName: connection.displayName,
      workspaceId: connection.workspaceId,
      workspaceName: connection.workspaceName,
      expectedLastRefreshedAt: lastRefreshed,
      expectedConnectionId: storedConnection._id,
    });

    const updated = (await ctx.runQuery(
      internal.oauth.slack.getConnectionInternal,
      { userId },
    )) as StoredSlackConnection | null;

    if (updated && updated.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
      const updatedCredentials = await decryptOAuthCredentials({
        userId,
        provider: "slack",
        accessToken: updated.accessToken,
        refreshToken: updated.refreshToken,
      });
      const decryptedUpdated: StoredSlackConnection = {
        ...updated,
        ...updatedCredentials,
      };
      return { accessToken: decryptedUpdated.accessToken, connection: decryptedUpdated };
    }
  }

  throw new ConvexError({
    code: "TOKEN_REFRESH_FAILED" as const,
    message: "Failed to refresh Slack token after multiple attempts. Ask the user to reconnect Slack.",
  });
}
