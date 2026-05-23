import { ConvexError, v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import { resolveGoogleOAuthClientConfigForRedirect } from "./google_client_config";
import { googleScopesForIntegration, mergeGoogleScopes } from "./google_capabilities";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export const exchangeGoogleOnePickCode = action({
  args: {
    code: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
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

    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(tokenParams),
    });
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Google OnePick token exchange failed:", errorText);
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

    await ctx.runMutation(internal.oauth.google.upsertConnection, {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? "",
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
