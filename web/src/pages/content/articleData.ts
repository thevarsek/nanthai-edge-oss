export type Collection = "guides" | "research";
export interface Article {
  slug: string;
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

/** The same source parser feeds client routes and the build-time renderer. */
export function parseArticle(source: string, filename: string): Article {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Missing frontmatter: ${filename}`);
  const fields = Object.fromEntries(match[1].split(/\r?\n/).map(line => {
    const colon = line.indexOf(":");
    return [line.slice(0, colon), line.slice(colon + 1).trim()];
  }));
  for (const key of ["title", "description", "updated", "related"]) {
    if (!fields[key]) throw new Error(`Missing ${key}: ${filename}`);
  }
  const collection = filename.includes("/guides/") ? "guides" : "research";
  return {
    slug: filename.split("/").pop()!.replace(/\.md$/, ""),
    collection,
    title: fields.title,
    description: fields.description,
    topic: fields.topic ?? "Choosing and comparing models",
    published: fields.published ?? fields.updated,
    updated: fields.updated,
    related: fields.related.replace(/^\[|\]$/g, "").split(",").map(value => value.trim()).filter(Boolean),
    image: fields.image,
    body: match[2].replace(/^# .+\r?\n+/m, "").trim(),
  };
}

const sources = import.meta.glob<string>("../../../content/{guides,research}/*.md", {
  query: "?raw", import: "default", eager: true,
});
export const articles = Object.entries(sources).map(([filename, source]) => parseArticle(source, filename));
export const collectionTitles = { guides: "Guides", research: "Research" };
export const collectionDescriptions = {
  guides: "Practical guides to choosing AI models, comparing answers, understanding costs and working with your files in NanthAI Edge.",
  research: "Articles from NanthAI on agent context, tool gates and memory, with diagrams and references.",
};
export function articlePath(article: Article) {
  return `/${article.collection}/${article.slug}`;
}
export function headingId(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-");
}
export function articleJsonLd(article: Article) {
  return {
    "@context": "https://schema.org", "@type": "Article",
    headline: article.title, description: article.description,
    datePublished: article.published, dateModified: article.updated,
    mainEntityOfPage: `https://nanthai.tech${articlePath(article)}`,
    image: `https://nanthai.tech${article.image ?? "/apple-splash-1200x630.png"}`,
    author: { "@type": "Organization", name: "NanthAI", url: "https://nanthai.tech/" },
    publisher: { "@type": "Organization", name: "NanthAI", url: "https://nanthai.tech/", logo: { "@type": "ImageObject", url: "https://nanthai.tech/apple-touch-icon.png" } },
  };
}

export function collectionJsonLd(collection: Collection) {
  return {
    "@context": "https://schema.org", "@type": "CollectionPage",
    name: collectionTitles[collection], description: collectionDescriptions[collection],
    url: `https://nanthai.tech/${collection}`,
    publisher: { "@type": "Organization", name: "NanthAI", url: "https://nanthai.tech/" },
    mainEntity: { "@type": "ItemList", itemListElement: articles.filter(article => article.collection === collection).map((article, i) => ({
      "@type": "ListItem", position: i + 1, item: articleJsonLd(article),
    })) },
  };
}
