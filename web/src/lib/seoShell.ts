const publicSeoPaths = new Set([
  "/",
  "/privacy",
  "/terms",
  "/support",
  "/licensing",
]);

const managedHeadSelectors = [
  "title",
  'meta[name="description"]',
  'meta[name="robots"]',
  'link[rel="canonical"]',
  'meta[property="og:type"]',
  'meta[property="og:url"]',
  'meta[property="og:title"]',
  'meta[property="og:description"]',
  'meta[property="og:image"]',
  'meta[name="twitter:card"]',
  'meta[name="twitter:title"]',
  'meta[name="twitter:description"]',
  'meta[name="twitter:image"]',
].join(",");

export function isPublicSeoPath(pathname: string) {
  return publicSeoPaths.has(pathname) || pathname === "/features" || pathname.startsWith("/features/");
}

export function removeBuildTimeSeoShell(pathname: string) {
  if (typeof document === "undefined" || !isPublicSeoPath(pathname)) return;
  document.head.querySelectorAll(managedHeadSelectors).forEach((element) => element.remove());
}
