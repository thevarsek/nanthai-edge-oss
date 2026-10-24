/** Content URLs own their language; the rest of the site keeps client-side switching. */
export const contentLanguages = ["en", "es", "fr", "de", "it", "ja", "zh"] as const;
export type ContentLanguage = typeof contentLanguages[number];
export type Collection = "guides" | "research";

export function contentLanguage(language?: string): ContentLanguage {
  const base = language?.toLowerCase().split("-")[0];
  return contentLanguages.find(code => code === base) ?? "en";
}

export function contentPath(collection: Collection, language: ContentLanguage = "en", slug?: string) {
  return `${language === "en" ? "" : `/${language}`}/${collection}${slug ? `/${slug}` : ""}`;
}

export function parseContentPath(pathname: string) {
  const match = pathname.match(/^\/(?:(es|fr|de|it|ja|zh)\/)?(guides|research)(?:\/([^/]+))?\/?$/);
  if (!match) return undefined;
  return { language: contentLanguage(match[1]), collection: match[2] as Collection, slug: match[3] };
}

export function localizeContentPath(pathname: string, language: ContentLanguage) {
  const route = parseContentPath(pathname);
  return route ? contentPath(route.collection, language, route.slug) : pathname;
}
