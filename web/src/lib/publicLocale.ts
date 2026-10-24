import { contentLanguage, contentLanguages, parseContentPath, type ContentLanguage } from "./contentLocale";
import { marketingPaths } from "./marketingPaths";

export function parsePublicPath(pathname: string) {
  if (!pathname.startsWith("/")) return undefined;
  const normalized = pathname.replace(/\/+$/, "") || "/";
  const prefix = normalized.match(/^\/(es|fr|de|it|ja|zh)(?=\/|$)/);
  const path = prefix ? normalized.slice(prefix[0].length) || "/" : normalized;
  const content = parseContentPath(normalized);
  if (!content && !marketingPaths.some(entry => entry === path)) return undefined;
  return { path, language: contentLanguage(prefix?.[1]) };
}

export function publicPath(pathname: string, language: ContentLanguage) {
  const route = parsePublicPath(pathname);
  if (!route) return pathname;
  return `${language === "en" ? "" : `/${language}`}${route.path === "/" && language !== "en" ? "" : route.path}`;
}

export function publicAlternates(pathname: string) {
  return [...contentLanguages.map(language => ({ language, url: `https://nanthai.tech${publicPath(pathname, language)}` })),
    { language: "x-default", url: `https://nanthai.tech${publicPath(pathname, "en")}` }];
}

/** Only the explicit switchers write this shared app/public preference. */
export function readLanguagePreference() {
  try { return typeof window === "undefined" ? null : localStorage.getItem("nanthai_language"); } catch { return null; }
}

export function preferredPublicPath(pathname: string, savedLanguage: string | null, availableLanguages: readonly string[] = contentLanguages) {
  const route = parsePublicPath(pathname);
  const preferred = contentLanguage(savedLanguage ?? "en");
  if (!route || route.language !== "en" || preferred === "en" || !availableLanguages.includes(preferred)) return undefined;
  return publicPath(pathname, preferred);
}
