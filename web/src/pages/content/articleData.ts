import { contentLanguage, contentLanguages, contentPath, type ContentLanguage, type Collection } from "@/lib/contentLocale";

export type { Collection } from "@/lib/contentLocale";
export interface Article {
  slug: string;
  language: ContentLanguage;
  collection: Collection;
  title: string;
  description: string;
  topic: string;
  published: string;
  updated: string;
  related: string[];
  image?: string;
  body: string;
}

function frontmatterValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value) as string;
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

/** The same flat-YAML parser feeds client routes and the build-time renderer. */
export function parseArticle(source: string, filename: string): Article {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Missing frontmatter: ${filename}`);
  const fields = Object.fromEntries(match[1].split(/\r?\n/).map(line => {
    const colon = line.indexOf(":");
    return [line.slice(0, colon), frontmatterValue(line.slice(colon + 1).trim())];
  }));
  for (const key of ["title", "description", "updated", "related"]) {
    if (!fields[key]) throw new Error(`Missing ${key}: ${filename}`);
  }
  const collection = filename.includes("/guides/") ? "guides" : "research";
  return {
    slug: filename.split("/").pop()!.replace(/\.md$/, ""),
    collection,
    language: contentLanguage(filename.split("/").at(-2)),
    title: fields.title,
    description: fields.description,
    topic: fields.topic ?? "Choosing and comparing models",
    published: fields.published ?? fields.updated,
    updated: fields.updated,
    related: fields.related.replace(/^\[|\]$/g, "").split(",").map(value => frontmatterValue(value.trim())).filter(Boolean),
    image: fields.image,
    body: match[2].replace(/^# .+\r?\n+/m, "").trim(),
  };
}

const sources = import.meta.glob<string>(["../../../content/{guides,research}/*.md", "../../../content/{guides,research}/{es,fr,de,it,ja,zh}/*.md"], {
  query: "?raw", import: "default", eager: true,
});
export const allArticles = Object.entries(sources).map(([filename, source]) => parseArticle(source, filename));
export const articles = allArticles.filter(article => article.language === "en");

/** English defines the catalogue and topic groups; translations can arrive independently. */
export function localizedArticles(collection: Collection, language: ContentLanguage, catalogue = allArticles) {
  return catalogue.filter(article => article.collection === collection && article.language === "en").map(english => {
    const translated = catalogue.find(article => article.collection === collection && article.slug === english.slug && article.language === language);
    return translated ? { ...translated, topic: english.topic } : english;
  });
}

export function contentAlternates(collection: Collection, slug?: string, catalogue = allArticles) {
  const available = contentLanguages.filter(language => !slug || catalogue.some(article => article.collection === collection && article.slug === slug && article.language === language));
  return [...available.map(language => ({ language: language as string, url: `https://nanthai.tech${contentPath(collection, language, slug)}` })),
    { language: "x-default", url: `https://nanthai.tech${contentPath(collection, "en", slug)}` }];
}
export function articlePath(article: Article, language = article.language) {
  return contentPath(article.collection, language, article.slug);
}
export function headingId(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-");
}
export function articleJsonLd(article: Article, language = article.language) {
  return {
    "@context": "https://schema.org", "@type": "Article",
    inLanguage: article.language,
    headline: article.title, description: article.description,
    datePublished: article.published, dateModified: article.updated,
    mainEntityOfPage: `https://nanthai.tech${articlePath(article, language)}`,
    image: `https://nanthai.tech${article.image ?? "/apple-splash-1200x630.png"}`,
    author: { "@type": "Organization", name: "NanthAI", url: "https://nanthai.tech/" },
    publisher: { "@type": "Organization", name: "NanthAI", url: "https://nanthai.tech/", logo: { "@type": "ImageObject", url: "https://nanthai.tech/apple-touch-icon.png" } },
  };
}

export function collectionJsonLd(collection: Collection, language: ContentLanguage, title: string, description: string) {
  return {
    "@context": "https://schema.org", "@type": "CollectionPage",
    name: title, description, inLanguage: language,
    url: `https://nanthai.tech${contentPath(collection, language)}`,
    publisher: { "@type": "Organization", name: "NanthAI", url: "https://nanthai.tech/" },
    mainEntity: { "@type": "ItemList", itemListElement: localizedArticles(collection, language).map((article, i) => ({
      "@type": "ListItem", position: i + 1, item: articleJsonLd(article, language),
    })) },
  };
}
