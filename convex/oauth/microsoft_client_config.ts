import { ConvexError } from "convex/values";

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

function trimEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export type MicrosoftOAuthClientType = "native" | "web";

type MicrosoftOAuthClientConfig = {
  clientId: string;
  clientSecret?: string;
  clientType: MicrosoftOAuthClientType;
};

export function resolveMicrosoftOAuthClientConfigForRedirect(
  redirectUri: string,
): MicrosoftOAuthClientConfig {
  let protocol: string | null = null;
  try {
    protocol = new URL(redirectUri).protocol;
  } catch {
    protocol = redirectUri.split(":", 1)[0]?.toLowerCase() + ":";
  }

  return protocol && HTTP_PROTOCOLS.has(protocol)
    ? resolveWebMicrosoftOAuthClientConfig()
    : resolveNativeMicrosoftOAuthClientConfig();
}

export function resolveStoredMicrosoftOAuthClientConfig(
  clientType?: string,
): MicrosoftOAuthClientConfig {
  return clientType === "web"
    ? resolveWebMicrosoftOAuthClientConfig()
    : resolveNativeMicrosoftOAuthClientConfig();
}

function resolveNativeMicrosoftOAuthClientConfig(): MicrosoftOAuthClientConfig {
  const clientId = trimEnv("MICROSOFT_CLIENT_ID");
  if (!clientId) {
    throw new ConvexError({
      code: "MISSING_CONFIG" as const,
      message: "MICROSOFT_CLIENT_ID environment variable not set.",
    });
  }

  return { clientId, clientType: "native" };
}

function resolveWebMicrosoftOAuthClientConfig(): MicrosoftOAuthClientConfig {
  const clientId = trimEnv("MICROSOFT_WEB_CLIENT_ID") || trimEnv("MICROSOFT_CLIENT_ID");
  if (!clientId) {
    throw new ConvexError({
      code: "MISSING_CONFIG" as const,
      message: "Microsoft web OAuth is not configured. Set MICROSOFT_WEB_CLIENT_ID or MICROSOFT_CLIENT_ID environment variable.",
    });
  }

  const clientSecret = trimEnv("MICROSOFT_WEB_CLIENT_SECRET")
    || trimEnv("MICROSOFT_CLIENT_SECRET");
  if (!clientSecret) {
    throw new ConvexError({
      code: "MISSING_CONFIG" as const,
      message: "Microsoft web OAuth is not configured. Set MICROSOFT_WEB_CLIENT_SECRET or MICROSOFT_CLIENT_SECRET environment variable.",
    });
  }

  return { clientId, clientSecret, clientType: "web" };
}
