const publicSeoPaths = new Set([
  "/",
  "/privacy",
  "/terms",
  "/support",
  "/licensing",
]);

export function isPublicSeoPath(pathname: string) {
  return publicSeoPaths.has(pathname) || pathname === "/features" || pathname.startsWith("/features/");
}

export function removeBuildTimeSeoShell(pathname: string) {
  if (typeof document === "undefined" || !isPublicSeoPath(pathname)) return;
  removeBuildTimeSeoShellElements();
}

export function removeBuildTimeSeoShellElements() {
  if (typeof document === "undefined") return;
  document.head.querySelectorAll("[data-seo-shell]").forEach((element) => element.remove());
}
