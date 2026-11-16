import { ConvexError, v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import { resolveGoogleOAuthClientConfigForRedirect } from "./google_client_config";
import { googleScopesForIntegration, mergeGoogleScopes } from "./google_capabilities";
import {
  decryptSecret,
  encryptOAuthCredentials,
  encryptSecret,
  googleOnePickSessionSecretContext,
  parseSecretEnvelope,
} from "../lib/secret_crypto";
import { getGoogleAccessToken } from "../tools/google/auth";
import {
  isWellFormedOnePickHandle,
  onePickPkceRequired,
  randomBase64Url,
  sha256Base64Url,
} from "./google_onepick_sessions";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

function invalidSession(): ConvexError<{ code: "ONEPICK_SESSION_INVALID"; message: string }> {
  return new ConvexError({
    code: "ONEPICK_SESSION_INVALID" as const,
    message: "This Google Drive request expired or was already used. Try again.",
  });
}

function requireWebRedirect(redirectUri: string): void {
  let protocol = "";
  try {
    protocol = new URL(redirectUri).protocol;
  } catch {
    protocol = "";
  }
  if (protocol !== "https:" && protocol !== "http:") {
    throw new ConvexError({ code: "VALIDATION" as const, message: "The Drive picker relay URL is invalid." });
  }
}

/**
 * Starts a native OnePick attempt. Returns an opaque relay handle (placed in
 * the OAuth `state` instead of a Google access token) and the PKCE challenge
 * for the authorization URL. The verifier stays encrypted on the server.
 */
export const startGoogleOnePick = action({
  args: { redirectUri: v.string() },
  handler: async (ctx, args): Promise<{
    relayHandle: string;
    codeChallenge: string;
    codeChallengeMethod: "S256";
    expiresAt: number;
  }> => {
    const { userId } = await requireAuth(ctx);
    requireWebRedirect(args.redirectUri);
    // Same precondition as getDrivePickerAccessToken: an active Drive grant.
    await getGoogleAccessToken(ctx, userId, "drive");

    const relayHandle = randomBase64Url(32);
    const verifier = randomBase64Url(48);
    const handleHash = await sha256Base64Url(relayHandle);
    const encryptedPkceVerifier = await encryptSecret(
      verifier,
      googleOnePickSessionSecretContext(userId, handleHash),
    );
    const secretKeyId = parseSecretEnvelope(encryptedPkceVerifier)?.keyId ?? "";
    const { expiresAt } = await ctx.runMutation(internal.oauth.google_onepick_sessions.createSession, {
      userId,
      handleHash,
      encryptedPkceVerifier,
      secretKeyId,
      redirectUri: args.redirectUri,
    });
    return {
      relayHandle,
      codeChallenge: await sha256Base64Url(verifier),
      codeChallengeMethod: "S256",
      expiresAt,
    };
  },
});

/**
 * Called by the signed-out `/mobile-drive-picker` relay page when Google did
 * not return picked files and the page must open the Picker itself. The handle
 * works once; after that, a copy from logs or browser history is useless.
 */
export const redeemGoogleOnePickRelayHandle = action({
  args: { relayHandle: v.string() },
  handler: async (ctx, args): Promise<{ accessToken: string; expiresAt?: number }> => {
    if (!isWellFormedOnePickHandle(args.relayHandle)) throw invalidSession();
    const claim = await ctx.runMutation(internal.oauth.google_onepick_sessions.claimRelayHandle, {
      handleHash: await sha256Base64Url(args.relayHandle),
    });
    if (!claim) throw invalidSession();
    const { accessToken, connection } = await getGoogleAccessToken(ctx, claim.userId, "drive");
    return { accessToken, expiresAt: connection.expiresAt ?? undefined };
  },
});

export const exchangeGoogleOnePickCode = action({
  args: {
    code: v.string(),
    redirectUri: v.string(),
    relayHandle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    let codeVerifier: string | undefined;
    if (args.relayHandle !== undefined) {
      if (!isWellFormedOnePickHandle(args.relayHandle)) throw invalidSession();
      const handleHash = await sha256Base64Url(args.relayHandle);
      const session = await ctx.runMutation(internal.oauth.google_onepick_sessions.consumeSession, {
        userId,
        handleHash,
      });
      if (!session || session.redirectUri !== args.redirectUri) throw invalidSession();
      codeVerifier = await decryptSecret(
        session.encryptedPkceVerifier,
        googleOnePickSessionSecretContext(userId, handleHash),
      );
    } else if (onePickPkceRequired()) {
      throw new ConvexError({
        code: "ONEPICK_UPGRADE_REQUIRED" as const,
        message: "Update NanthAI to attach files from Google Drive.",
      });
    } else {
      console.warn("[oauth] Google OnePick exchange without PKCE (legacy client)");
    }

    const clientConfig = resolveGoogleOAuthClientConfigForRedirect(args.redirectUri);
    const tokenParams: Record<string, string> = {
      code: args.code,
      client_id: clientConfig.clientId,
      redirect_uri: args.redirectUri,
      grant_type: "authorization_code",
    };
    if (clientConfig.clientSecret) {
      tokenParams.client_secret = clientConfig.clientSecret;
    }
    if (codeVerifier) {
      tokenParams.code_verifier = codeVerifier;
    }

    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(tokenParams),
    });
    if (!tokenResponse.ok) {
      throw new ConvexError({
        code: "EXTERNAL_SERVICE",
        message: `Google OnePick token exchange failed (HTTP ${tokenResponse.status})`,
      });
    }

    const tokens = (await tokenResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!tokens.access_token) {
      throw new ConvexError({ code: "EXTERNAL_SERVICE", message: "Google did not return an access token." });
    }

    let email: string | undefined;
    let displayName: string | undefined;
    try {
      const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userInfoResponse.ok) {
        const userInfo = (await userInfoResponse.json()) as { email?: string; name?: string };
        email = userInfo.email;
        displayName = userInfo.name;
      }
    } catch {
      console.warn("Failed to fetch Google user info after OnePick exchange");
    }

    const encrypted = await encryptOAuthCredentials({
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? "",
      provider: "google",
    });
    await ctx.runMutation(internal.oauth.google.upsertConnection, {
      userId,
      ...encrypted,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      scopes: mergeGoogleScopes(
        googleScopesForIntegration("drive"),
        tokens.scope ? tokens.scope.split(" ") : [],
      ),
      email,
      displayName,
      clientType: clientConfig.clientType,
    });

    return { success: true, email: email ?? null };
  },
});
