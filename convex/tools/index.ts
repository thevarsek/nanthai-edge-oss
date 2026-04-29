// convex/tools/index.ts
// =============================================================================
// OAuth connection helpers used by the progressive tool registry to determine
// which integration tools to register for a given user.
// =============================================================================

import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { deriveGoogleCapabilityFlags } from "../oauth/google_capabilities";

/**
 * Get Google integrations that are both connected and scope-granted.
 */
export async function getGrantedGoogleIntegrations(
  ctx: ActionCtx,
  userId: string,
): Promise<string[]> {
  try {
    const connection = await ctx.runQuery(
      internal.oauth.google.getConnectionInternal,
      { userId },
    );
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
    const connection = await ctx.runQuery(
      internal.oauth.gmail_manual.getConnectionInternal,
      { userId },
    );
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
    const connection = await ctx.runQuery(
      internal.oauth.microsoft.getConnectionInternal,
      { userId },
    );
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
    const connection = await ctx.runQuery(
      internal.oauth.notion.getConnectionInternal,
      { userId },
    );
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
    const connection = await ctx.runQuery(
      internal.oauth.apple_calendar.getConnectionInternal,
      { userId },
    );
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
    const connection = await ctx.runQuery(
      internal.oauth.cloze.getConnectionInternal,
      { userId },
    );
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
    const connection = await ctx.runQuery(
      internal.oauth.slack.getConnectionInternal,
      { userId },
    );
    return connection !== null && connection.status === "active";
  } catch {
    return false;
  }
}
