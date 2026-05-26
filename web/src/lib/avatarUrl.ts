const TRUSTED_AVATAR_HOST_SUFFIXES = [".convex.cloud", ".convex.site"];

export function safeAvatarImageUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  const origin = globalThis.location?.origin ?? "http://localhost";
  try {
    const parsed = new URL(rawUrl, origin);
    if (parsed.protocol === "blob:") return parsed.href;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.origin === origin) return parsed.href;
    if (TRUSTED_AVATAR_HOST_SUFFIXES.some((suffix) => parsed.hostname.endsWith(suffix))) {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}
