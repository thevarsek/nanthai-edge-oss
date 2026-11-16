import { v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";

// Session lifetime covers Google consent plus file selection in the browser.
export const ONEPICK_SESSION_TTL_MS = 15 * 60 * 1000;
// The relay page redeems its handle as soon as it loads after Google consent,
// so the bearer window for the picker token is much shorter than the session.
export const ONEPICK_RELAY_REDEEM_WINDOW_MS = 5 * 60 * 1000;
export const ONEPICK_HANDLE_MAX_LENGTH = 256;
const EXPIRED_SESSION_PRUNE_LIMIT = 20;

/**
 * `OAUTH_ONEPICK_REQUIRE_PKCE=true` rejects Drive OnePick code exchanges that
 * do not present a server-issued relay handle (app builds released before the
 * PKCE flow). Unset or any other value keeps those builds working.
 */
export function onePickPkceRequired(env: Record<string, string | undefined> = process.env): boolean {
  return env.OAUTH_ONEPICK_REQUIRE_PKCE?.trim().toLowerCase() === "true";
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomBase64Url(byteLength = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

export function isWellFormedOnePickHandle(value: string): boolean {
  return value.length >= 32
    && value.length <= ONEPICK_HANDLE_MAX_LENGTH
    && /^[A-Za-z0-9_-]+$/.test(value);
}

export const createSession = internalMutation({
  args: {
    userId: v.string(),
    handleHash: v.string(),
    encryptedPkceVerifier: v.string(),
    secretKeyId: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const previous = await ctx.db
      .query("googleOnePickSessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(EXPIRED_SESSION_PRUNE_LIMIT);
    for (const session of previous) {
      if (session.expiresAt <= now || session.consumedAt !== undefined) {
        await ctx.db.delete(session._id);
      }
    }
    const expiresAt = now + ONEPICK_SESSION_TTL_MS;
    await ctx.db.insert("googleOnePickSessions", {
      userId: args.userId,
      handleHash: args.handleHash,
      encryptedPkceVerifier: args.encryptedPkceVerifier,
      secretEnvelopeVersion: 2,
      secretKeyId: args.secretKeyId,
      redirectUri: args.redirectUri,
      expiresAt,
      createdAt: now,
    });
    return { expiresAt };
  },
});

/** Single-use claim used by the signed-out relay page to obtain a picker token. */
export const claimRelayHandle = internalMutation({
  args: { handleHash: v.string() },
  handler: async (ctx, args): Promise<{ userId: string } | null> => {
    const session = await ctx.db
      .query("googleOnePickSessions")
      .withIndex("by_handle_hash", (q) => q.eq("handleHash", args.handleHash))
      .unique();
    const now = Date.now();
    if (
      !session
      || session.expiresAt <= now
      || session.createdAt + ONEPICK_RELAY_REDEEM_WINDOW_MS <= now
      || session.relayRedeemedAt !== undefined
      || session.consumedAt !== undefined
    ) {
      return null;
    }
    await ctx.db.patch(session._id, { relayRedeemedAt: now });
    return { userId: session.userId };
  },
});

/**
 * Called by the signed-out relay page when it finishes without opening the
 * Picker (Google already returned the picked files, or consent failed), so a
 * handle copied from a log can never be redeemed for a token. Burning only
 * removes the relay's token path; the app's code exchange still works. It
 * returns nothing, so it reveals nothing about the handle.
 */
export const burnGoogleOnePickRelayHandle = mutation({
  args: { relayHandle: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!isWellFormedOnePickHandle(args.relayHandle)) return null;
    const handleHash = await sha256Base64Url(args.relayHandle);
    const session = await ctx.db
      .query("googleOnePickSessions")
      .withIndex("by_handle_hash", (q) => q.eq("handleHash", handleHash))
      .unique();
    if (session && session.relayRedeemedAt === undefined) {
      await ctx.db.patch(session._id, { relayRedeemedAt: Date.now() });
    }
    return null;
  },
});

/** Single-use claim for the authorization-code exchange by the session owner. */
export const consumeSession = internalMutation({
  args: { userId: v.string(), handleHash: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("googleOnePickSessions")
      .withIndex("by_handle_hash", (q) => q.eq("handleHash", args.handleHash))
      .unique();
    if (
      !session
      || session.userId !== args.userId
      || session.expiresAt <= Date.now()
      || session.consumedAt !== undefined
    ) {
      return null;
    }
    await ctx.db.patch(session._id, { consumedAt: Date.now() });
    return {
      encryptedPkceVerifier: session.encryptedPkceVerifier,
      redirectUri: session.redirectUri,
    };
  },
});
