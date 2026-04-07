import { ConvexError } from "convex/values";

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

function trimEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export type GoogleOAuthClientType = "native" | "web";

type GoogleOAuthClientConfig = {
  clientId: string;
  clientSecret?: string;
  clientType: GoogleOAuthClientType;
};

export function resolveGoogleOAuthClientConfigForRedirect(
  redirectUri: string,
): GoogleOAuthClientConfig {
  let protocol: string | null = null;
  try {
    protocol = new URL(redirectUri).protocol;
  } catch {
    protocol = redirectUri.split(":", 1)[0]?.toLowerCase() + ":";
  }

  const isWebRedirect = protocol ? HTTP_PROTOCOLS.has(protocol) : false;
  return isWebRedirect
    ? resolveWebGoogleOAuthClientConfig()
    : resolveNativeGoogleOAuthClientConfig();
}

export function resolveStoredGoogleOAuthClientConfig(
  clientType?: string,
): GoogleOAuthClientConfig {
  return clientType === "web"
    ? resolveWebGoogleOAuthClientConfig()
    : resolveNativeGoogleOAuthClientConfig();
}

function resolveNativeGoogleOAuthClientConfig(): GoogleOAuthClientConfig {
  const clientId = trimEnv("GOOGLE_CLIENT_ID");
  if (!clientId) {
    throw new ConvexError({
      code: "MISSING_CONFIG" as const,
      message: "Google native OAuth is not configured. Set GOOGLE_CLIENT_ID environment variable.",
    });
  }

  return { clientId, clientType: "native" };
}

function resolveWebGoogleOAuthClientConfig(): GoogleOAuthClientConfig {
  const clientId = trimEnv("GOOGLE_WEB_CLIENT_ID") || trimEnv("GOOGLE_CLIENT_ID");
  if (!clientId) {
    throw new ConvexError({
      code: "MISSING_CONFIG" as const,
      message: "Google web OAuth is not configured. Set GOOGLE_WEB_CLIENT_ID environment variable.",
    });
  }

  const clientSecret = trimEnv("GOOGLE_WEB_CLIENT_SECRET") || trimEnv("GOOGLE_CLIENT_SECRET");

  return { clientId, clientSecret, clientType: "web" };
}
