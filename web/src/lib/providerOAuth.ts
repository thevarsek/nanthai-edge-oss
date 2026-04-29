export type OAuthProvider = "google" | "microsoft" | "notion" | "slack";
export type GoogleRequestedIntegration = "base" | "gmail" | "drive" | "calendar" | "workspace";

type OAuthContext = {
  state: string;
  verifier?: string;
  redirectUri: string;
  createdAt: number;
  requestedIntegration?: GoogleRequestedIntegration;
};

export type OAuthPopupMessage = {
  type: "nanthai-oauth-result";
  provider: OAuthProvider;
  success: boolean;
  error?: string;
};

const STORAGE_PREFIX = "nanthai.oauth";
const RANDOM_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
const GOOGLE_BASE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];
const MICROSOFT_SCOPES = [
  "Mail.ReadWrite",
  "Mail.Send",
  "Files.ReadWrite.All",
  "Calendars.ReadWrite",
  "User.Read",
  "offline_access",
];

function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => RANDOM_CHARS[byte % RANDOM_CHARS.length]).join("");
}

async function sha256Base64Url(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const bytes = Array.from(new Uint8Array(hash), (byte) => String.fromCharCode(byte)).join("");
  return btoa(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function storageKey(provider: OAuthProvider): string {
  return `${STORAGE_PREFIX}.${provider}`;
}

function getClientId(provider: OAuthProvider): string | null {
  const value =
    provider === "google"
      ? import.meta.env.VITE_GOOGLE_CLIENT_ID
      : provider === "microsoft"
        ? import.meta.env.VITE_MICROSOFT_CLIENT_ID
        : provider === "notion"
          ? import.meta.env.VITE_NOTION_CLIENT_ID
          : import.meta.env.VITE_SLACK_CLIENT_ID;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function getOAuthCallbackPath(provider: OAuthProvider): string {
  return `/oauth/${provider}/callback`;
}

export function getOAuthCallbackUrl(provider: OAuthProvider): string {
  return `${window.location.origin}${getOAuthCallbackPath(provider)}`;
}

export function getOAuthClientId(provider: OAuthProvider): string | null {
  return getClientId(provider);
}

export function readOAuthContext(provider: OAuthProvider): OAuthContext | null {
  const raw = localStorage.getItem(storageKey(provider));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OAuthContext;
  } catch {
    localStorage.removeItem(storageKey(provider));
    return null;
  }
}

export function clearOAuthContext(provider: OAuthProvider) {
  localStorage.removeItem(storageKey(provider));
}

function googleScopesForIntegration(requestedIntegration: GoogleRequestedIntegration): string[] {
  const scopes = [...GOOGLE_BASE_SCOPES];
  if (requestedIntegration === "drive" || requestedIntegration === "workspace") {
    scopes.push("https://www.googleapis.com/auth/drive.file");
  }
  if (requestedIntegration === "calendar" || requestedIntegration === "workspace") {
    scopes.push("https://www.googleapis.com/auth/calendar.events");
  }
  return scopes;
}

export async function buildProviderAuthorizationUrl(
  provider: OAuthProvider,
  options?: { requestedIntegration?: GoogleRequestedIntegration },
): Promise<string> {
  const clientId = getClientId(provider);
  if (!clientId) {
    throw new Error(`${providerLabel(provider)} OAuth is not configured for web.`);
  }

  const redirectUri = getOAuthCallbackUrl(provider);

  if (provider === "google") {
    const requestedIntegration = options?.requestedIntegration ?? "base";
    const state = randomString(64);
    const verifier = randomString(64);
    const challenge = await sha256Base64Url(verifier);
    persistOAuthContext(provider, { state, verifier, redirectUri, createdAt: Date.now(), requestedIntegration });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: googleScopesForIntegration(requestedIntegration).join(" "),
      access_type: "offline",
      include_granted_scopes: "true",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  if (provider === "microsoft") {
    const state = randomString(64);
    const verifier = randomString(64);
    const challenge = await sha256Base64Url(verifier);
    persistOAuthContext(provider, { state, verifier, redirectUri, createdAt: Date.now() });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: MICROSOFT_SCOPES.join(" "),
      response_mode: "query",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      prompt: "consent",
    });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  }

  const state = randomString(64);
  persistOAuthContext(provider, { state, redirectUri, createdAt: Date.now() });
  if (provider === "slack") {
    // https://docs.slack.dev/authentication/installing-with-oauth#the-user-centric-flow-the-oauthv2useraccess-method
    // https://docs.slack.dev/ai/slack-mcp-server#oauth-url-and-endpoints
    // MCP user-token-only apps use /oauth/v2_user/authorize with scope (not user_scope).
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "search:read.public,search:read.users,channels:history,users:read,users:read.email,search:read.private,search:read.mpim,search:read.im,search:read.files,chat:write,groups:history,mpim:history,im:history,canvases:read,canvases:write",
      state,
    });
    return `https://slack.com/oauth/v2_user/authorize?${params.toString()}`;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    owner: "user",
    state,
  });
  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
}

export function postOAuthResult(message: OAuthPopupMessage) {
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(message, window.location.origin);
  }
}

export async function connectProviderWithPopup(
  provider: OAuthProvider,
  options?: { requestedIntegration?: GoogleRequestedIntegration },
): Promise<void> {
  // Open the popup synchronously from the user gesture before any async PKCE work,
  // otherwise browsers can classify it as an unsolicited popup and block it.
  const popup = window.open("", "oauth-popup", "width=600,height=700,menubar=no,toolbar=no");
  if (!popup) {
    clearOAuthContext(provider);
    throw new Error(`Popup blocked. Allow popups for this site and try ${providerLabel(provider)} again.`);
  }

  popup.document.title = `Connecting ${providerLabel(provider)}...`;
  popup.document.body.innerHTML = "<p style=\"font-family: sans-serif; padding: 24px;\">Connecting...</p>";

  let url: string;
  try {
    url = await buildProviderAuthorizationUrl(provider, options);
    popup.location.href = url;
  } catch (error) {
    popup.close();
    clearOAuthContext(provider);
    throw error;
  }

  await new Promise<void>((resolve, reject) => {
    const onMessage = (event: MessageEvent<OAuthPopupMessage>) => {
      if (event.origin !== window.location.origin) return;
      const message = event.data;
      if (!message || message.type !== "nanthai-oauth-result" || message.provider !== provider) return;
      cleanup();
      if (message.success) {
        resolve();
      } else {
        reject(new Error(message.error ?? `${providerLabel(provider)} connection failed.`));
      }
    };

    const onCloseCheck = window.setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      reject(new Error(`${providerLabel(provider)} sign-in was cancelled.`));
    }, 400);

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(onCloseCheck);
      popup.close();
    };

    window.addEventListener("message", onMessage);
  });
}

export function providerLabel(provider: OAuthProvider): string {
  return provider === "google"
    ? "Google"
    : provider === "microsoft"
      ? "Microsoft"
      : provider === "notion"
        ? "Notion"
        : "Slack";
}

function persistOAuthContext(provider: OAuthProvider, context: OAuthContext) {
  localStorage.setItem(storageKey(provider), JSON.stringify(context));
}
