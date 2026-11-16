// Decides which URLs may be auto-loaded as inline markdown images.
//
// `*.convex.cloud` and `*.convex.site` are shared by every Convex customer, so
// a suffix match would let any third-party deployment receive requests from
// the browser. Only the app's own configured deployment is trusted.

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);
const CLOUD_SUFFIX = ".convex.cloud";
const SITE_SUFFIX = ".convex.site";

/** Own deployment hosts: the configured host plus its `.convex.cloud` / `.convex.site` twin. */
export function trustedConvexImageHosts(configuredUrls: ReadonlyArray<string | undefined>): Set<string> {
  const hosts = new Set<string>();
  for (const raw of configuredUrls) {
    if (!raw) continue;
    let host: string;
    try {
      host = new URL(raw.trim()).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (!host) continue;
    hosts.add(host);
    if (host.endsWith(CLOUD_SUFFIX)) hosts.add(host.slice(0, -CLOUD_SUFFIX.length) + SITE_SUFFIX);
    else if (host.endsWith(SITE_SUFFIX)) hosts.add(host.slice(0, -SITE_SUFFIX.length) + CLOUD_SUFFIX);
  }
  return hosts;
}

function currentTrustedHosts(): Set<string> {
  return trustedConvexImageHosts([import.meta.env.VITE_CONVEX_URL as string | undefined]);
}

/** True when `url` is an https download link to an image on the app's own Convex deployment. */
export function isConvexImageUrl(url: string, trustedHosts: ReadonlySet<string> = currentTrustedHosts()): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return false;
    if (!trustedHosts.has(parsed.hostname.toLowerCase())) return false;
    if (parsed.pathname !== "/download") return false;
    const filename = parsed.searchParams.get("filename");
    if (!filename) return false;
    const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}
