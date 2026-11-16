// convex/security/credential_invalidation_oauth.ts
// =============================================================================
// Per-connection revoke + delete used by the admin credential-invalidation
// actions. Never returns or logs token values; `error` holds short codes only.
// =============================================================================

import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import {
  revokeGoogleConnection,
  revokeNotionConnection,
  revokeSlackConnection,
  type RevocationOutcome,
} from "../oauth/revocation";

/** Providers whose provider-side grant is revoked with a stored token. */
const REVOKING_PROVIDERS = new Set(["google", "notion", "slack"]);

export type ConnectionInvalidation = {
  provider: string;
  revoked: boolean;
  deleted: boolean;
  userActionRequired: boolean;
  error?: string;
};

async function revokeAtProvider(
  ctx: ActionCtx,
  userId: string,
  provider: string,
): Promise<RevocationOutcome> {
  switch (provider) {
    case "google": {
      const connection = await ctx.runQuery(internal.oauth.google.getConnectionInternal, { userId });
      return connection
        ? revokeGoogleConnection(userId, connection)
        : { revoked: false, error: "connection_missing" };
    }
    case "notion": {
      const connection = await ctx.runQuery(internal.oauth.notion.getConnectionInternal, { userId });
      return connection
        ? revokeNotionConnection(userId, connection)
        : { revoked: false, error: "connection_missing" };
    }
    default: {
      const connection = await ctx.runQuery(internal.oauth.slack.getConnectionInternal, { userId });
      return connection
        ? revokeSlackConnection(userId, connection)
        : { revoked: false, error: "connection_missing" };
    }
  }
}

async function deleteProviderConnection(
  ctx: ActionCtx,
  userId: string,
  provider: string,
): Promise<void> {
  switch (provider) {
    case "google":
      await ctx.runMutation(internal.oauth.google.deleteDriveFileGrantsForUser, { userId });
      await ctx.runMutation(internal.oauth.google.deleteConnection, { userId });
      return;
    case "notion":
      await ctx.runMutation(internal.oauth.notion.deleteConnection, { userId });
      return;
    case "slack":
      await ctx.runMutation(internal.oauth.slack.deleteConnection, { userId });
      return;
    case "microsoft":
      await ctx.runMutation(internal.oauth.microsoft.deleteConnection, { userId });
      return;
    case "gmail_manual":
      await ctx.runMutation(internal.oauth.gmail_manual.deleteConnection, { userId });
      return;
    case "apple_calendar":
      await ctx.runMutation(internal.oauth.apple_calendar.deleteConnection, { userId });
      return;
    case "cloze":
      await ctx.runMutation(internal.oauth.cloze.deleteConnection, { userId });
      return;
    default:
      await ctx.runMutation(
        internal.security.credential_invalidation.deleteOAuthConnectionsForProvider,
        { userId, provider },
      );
  }
}

export async function invalidateConnection(
  ctx: ActionCtx,
  userId: string,
  provider: string,
): Promise<ConnectionInvalidation> {
  const revocable = REVOKING_PROVIDERS.has(provider);
  let revoked = false;
  const errors: string[] = [];

  if (revocable) {
    try {
      const outcome = await revokeAtProvider(ctx, userId, provider);
      revoked = outcome.revoked;
      if (!outcome.revoked) errors.push(`revoke_failed:${outcome.error ?? "unknown"}`);
    } catch {
      errors.push("revoke_failed:unexpected");
    }
  }

  let deleted = false;
  try {
    await deleteProviderConnection(ctx, userId, provider);
    deleted = true;
  } catch {
    errors.push("delete_failed");
  }

  // Providers without a revoke API (Microsoft, Cloze) and app-password providers
  // (Gmail manual, Apple Calendar) leave the grant alive on the provider side.
  const userActionRequired = !deleted || !revocable || !revoked;
  return {
    provider,
    revoked,
    deleted,
    userActionRequired,
    ...(errors.length > 0 ? { error: errors.join(";") } : {}),
  };
}

