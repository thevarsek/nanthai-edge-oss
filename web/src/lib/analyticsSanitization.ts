import type { Properties } from "posthog-js";

const SENSITIVE_ROUTE_PROPERTY_KEYS = new Set([
  "$current_url",
  "$initial_current_url",
  "$referrer",
  "$initial_referrer",
  "current_url",
  "initial_current_url",
  "referrer",
  "initial_referrer",
  "url",
  "path",
  "pathname",
  "route",
  "route_or_screen",
  "routeOrScreen",
  "client_route_or_screen",
]);

const BOT_USER_AGENT = /bot|crawl|spider|slurp|teoma|headlesschrome|lighthouse/i;
const PRODUCTION_HOSTS = new Set(["nanthai.tech", "www.nanthai.tech"]);

export function stripQueryAndHash(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");
  const candidates = [queryIndex, hashIndex].filter((index) => index >= 0);
  if (candidates.length === 0) return value;
  return value.slice(0, Math.min(...candidates));
}

export function sanitizeAutomaticUrlProperties(properties: Properties) {
  for (const key of SENSITIVE_ROUTE_PROPERTY_KEYS) {
    const sanitized = stripQueryAndHash(properties[key]);
    if (sanitized !== undefined) properties[key] = sanitized;
  }
}

export function sanitizeAnalyticsProperties(properties: Properties): Properties {
  const sanitized = { ...properties };
  sanitizeAutomaticUrlProperties(sanitized);
  return sanitized;
}

export function isAllowedAnalyticsEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  if (import.meta.env.MODE === "test") return true;
  if (!import.meta.env.PROD || !PRODUCTION_HOSTS.has(window.location.hostname)) return false;
  if (navigator.webdriver) return false;
  return !BOT_USER_AGENT.test(navigator.userAgent);
}

export function sanitizedPageUrl(pathname: string): string {
  const path = stripQueryAndHash(pathname) ?? "/";
  if (typeof window === "undefined") return `https://nanthai.tech${path}`;
  return `${window.location.origin}${path}`;
}
