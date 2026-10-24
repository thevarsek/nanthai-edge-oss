import { parseContentPath } from "./contentLocale";

const publicSeoPaths = new Set([
  "/",
  "/privacy",
  "/terms",
  "/support",
  "/licensing",
  "/workflows",
  "/local-runtime",
  "/research/results",
  "/research/methods",
]);

export function isPublicSeoPath(pathname: string) {
  return Boolean(parseContentPath(pathname)) || pathname === "/guides" || pathname.startsWith("/guides/") || pathname === "/research" || pathname.startsWith("/research/") || publicSeoPaths.has(pathname) || pathname === "/features" || pathname.startsWith("/features/");
}

export function removeBuildTimeSeoShell(pathname: string) {
  if (typeof document === "undefined" || !isPublicSeoPath(pathname)) return;
  removeBuildTimeSeoShellElements();
}

export function removeBuildTimeSeoShellElements() {
  if (typeof document === "undefined") return;
  document.head.querySelectorAll("[data-seo-shell]").forEach((element) => element.remove());
}
