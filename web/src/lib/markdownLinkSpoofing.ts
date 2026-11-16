// Detects markdown links whose visible text names one site but whose target
// opens another, e.g. `[accounts.google.com](https://evil.example)`.

// TLDs common enough that a bare `name.tld` label is read as a site. Excludes
// TLDs that collide with file extensions (pdf, md, sh, py, rs, ...).
const COMMON_TLDS = new Set([
  "com", "net", "org", "io", "dev", "app", "ai", "co", "edu", "gov", "info",
  "biz", "me", "us", "uk", "de", "fr", "it", "es", "nl", "eu", "ca", "au",
  "jp", "cn", "ru", "br", "in", "ch", "se", "no", "tech", "xyz", "site",
  "online", "cloud", "news", "shop", "store",
]);

const DOMAIN_PATTERN = /^([\p{L}\p{N}-]+\.)+\p{L}{2,}(:\d+)?([/?#].*)?$/u;

function normalizeHost(host: string): string {
  const lowered = host.toLowerCase();
  return lowered.startsWith("www.") ? lowered.slice(4) : lowered;
}

function hostNamedByLabel(label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed || /\s/u.test(trimmed)) return null;
  const lowered = trimmed.toLowerCase();
  const hasScheme = lowered.startsWith("https://") || lowered.startsWith("http://");
  const withoutScheme = hasScheme ? lowered.slice(lowered.indexOf("://") + 3) : lowered;
  if (!DOMAIN_PATTERN.test(withoutScheme)) return null;
  const hostAndPort = withoutScheme.split(/[/?#]/u)[0] ?? "";
  const host = normalizeHost(hostAndPort.split(":")[0] ?? "");
  if (!host) return null;
  if (hasScheme || lowered.startsWith("www.")) return host;
  const tld = host.slice(host.lastIndexOf(".") + 1);
  return COMMON_TLDS.has(tld) ? host : null;
}

/** True when `label` looks like a URL or domain whose host differs from the host `href` opens. */
export function shouldConfirmLink(label: string, href: string): boolean {
  let targetHost: string;
  try {
    targetHost = normalizeHost(new URL(href).hostname);
  } catch {
    return false;
  }
  if (!targetHost) return false;
  const labelHost = hostNamedByLabel(label);
  if (!labelHost) return false;
  if (labelHost === targetHost) return false;
  return !targetHost.endsWith(`.${labelHost}`);
}
