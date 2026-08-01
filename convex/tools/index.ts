// convex/tools/index.ts
// =============================================================================
// OAuth connection helpers used by the progressive tool registry to determine
// which integration tools to register for a given user.
// =============================================================================

import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { deriveGoogleCapabilityFlags } from "../oauth/google_capabilities";

async function getConnectionStatus(
  ctx: ActionCtx,
  userId: string,
  provider: string,
): Promise<{ status: string; scopes: string[] } | null> {
  return await ctx.runQuery(internal.oauth.connection_status.getConnectionStatus, {
    userId,
    provider,
  });
}

/**
 * Get Google integrations that are both connected and scope-granted.
 */
export async function getGrantedGoogleIntegrations(
  ctx: ActionCtx,
  userId: string,
): Promise<string[]> {
  try {
    const connection = await getConnectionStatus(ctx, userId, "google");
    if (connection === null || connection.status !== "active") {
      return [];
    }
    const flags = deriveGoogleCapabilityFlags(connection.scopes);
    const integrations: string[] = [];
    if (flags.hasDrive) integrations.push("drive");
    if (flags.hasCalendar) integrations.push("calendar");
    return integrations;
  } catch {
    return [];
  }
}

export async function checkGmailManualConnection(
  ctx: ActionCtx,
  userId: string,
): Promise<boolean> {
  try {
    const connection = await getConnectionStatus(ctx, userId, "gmail_manual");
    return connection !== null && connection.status === "active";
  } catch {
    return false;
  }
}

/**
 * Check whether a user has an active Microsoft OAuth connection.
 */
export async function checkMicrosoftConnection(
  ctx: ActionCtx,
  userId: string,
): Promise<boolean> {
  try {
    const connection = await getConnectionStatus(ctx, userId, "microsoft");
    return connection !== null && connection.status === "active";
  } catch {
    return false;
  }
}

/**
 * Check whether a user has an active Notion OAuth connection.
 */
export async function checkNotionConnection(
  ctx: ActionCtx,
  userId: string,
): Promise<boolean> {
  try {
    const connection = await getConnectionStatus(ctx, userId, "notion");
    return connection !== null && connection.status === "active";
  } catch {
    return false;
  }
}

/**
 * Check whether a user has an active Apple Calendar connection.
 */
export async function checkAppleCalendarConnection(
  ctx: ActionCtx,
  userId: string,
): Promise<boolean> {
  try {
    const connection = await getConnectionStatus(ctx, userId, "apple_calendar");
    return connection !== null && connection.status === "active";
  } catch {
    return false;
  }
}

/**
 * Check whether a user has an active Cloze connection.
 */
export async function checkClozeConnection(
  ctx: ActionCtx,
  userId: string,
): Promise<boolean> {
  try {
    const connection = await getConnectionStatus(ctx, userId, "cloze");
    return connection !== null && connection.status === "active";
  } catch {
    return false;
  }
}

/**
 * Check whether a user has an active Slack OAuth connection.
 */
export async function checkSlackConnection(
  ctx: ActionCtx,
  userId: string,
): Promise<boolean> {
  try {
    const connection = await getConnectionStatus(ctx, userId, "slack");
    return connection !== null && connection.status === "active";
  } catch {
    return false;
  }
}
