import type { OAuthProvider } from "@/lib/providerOAuth";

/** Custom-scheme base URL for mobile apps (iOS / Android). */
const MOBILE_SCHEME = "tech.nanthai.NanthAi-Edge";
/** Android application ID; pins the relay hand-off to the NanthAI app. */
const ANDROID_PACKAGE = "com.nanthai.edge";

export function isMobileOAuthRelayRequest(userAgent = window.navigator.userAgent): boolean {
  return /Android|iPhone|iPad|iPod/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && /Mobile\//i.test(userAgent));
}

/**
 * Native hand-off URL for a provider callback. Android gets a package-pinned
 * `intent://` URL so another app that registers the same custom scheme cannot
 * receive the authorization code; iOS keeps the custom scheme, which its
 * ASWebAuthenticationSession delivers only to the app that started it.
 */
export function nativeOAuthCallbackUrl(
  provider: OAuthProvider,
  params: URLSearchParams,
  userAgent = window.navigator.userAgent,
): string {
  const query = params.toString();
  const pathAndQuery = `oauth/${provider}/callback${query ? `?${query}` : ""}`;
  if (/Android/i.test(userAgent)) {
    return `intent://${pathAndQuery}#Intent;scheme=${MOBILE_SCHEME};package=${ANDROID_PACKAGE};end`;
  }
  return `${MOBILE_SCHEME}://${pathAndQuery}`;
}

export function redirectToNativeOAuthCallback(url: string): void {
  window.location.href = url;
}
