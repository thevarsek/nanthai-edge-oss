import type { OAuthProvider } from "@/lib/providerOAuth";

/** Custom-scheme base URL for mobile apps (iOS / Android). */
const MOBILE_SCHEME = "tech.nanthai.NanthAi-Edge";

export function isMobileOAuthRelayRequest(userAgent = window.navigator.userAgent): boolean {
  return /Android|iPhone|iPad|iPod/i.test(userAgent);
}

export function nativeOAuthCallbackUrl(provider: OAuthProvider, params: URLSearchParams): string {
  const query = params.toString();
  return `${MOBILE_SCHEME}://oauth/${provider}/callback${query ? `?${query}` : ""}`;
}
