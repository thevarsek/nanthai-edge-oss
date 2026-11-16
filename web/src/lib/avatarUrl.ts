import { trustedConvexImageHosts } from "./markdownImageHost";

/**
 * Avatar images may come from the app's own origin, a local blob, or the app's
 * own Convex deployment. Other `*.convex.cloud` / `*.convex.site` hosts belong
 * to unrelated deployments and are rejected.
 */
export function safeAvatarImageUrl(
  rawUrl?: string | null,
  trustedHosts: ReadonlySet<string> = trustedConvexImageHosts([import.meta.env.VITE_CONVEX_URL as string | undefined]),
): string | null {
  if (!rawUrl) return null;
  const origin = globalThis.location?.origin ?? "http://localhost";
  try {
    const parsed = new URL(rawUrl, origin);
    if (parsed.protocol === "blob:") return parsed.href;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.origin === origin) return parsed.href;
    if (parsed.protocol === "https:" && trustedHosts.has(parsed.hostname.toLowerCase())) {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}
