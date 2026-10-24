import { describe, expect, it } from "vitest";
import { allArticles, articles, articleJsonLd, articlePath, contentAlternates, localizedArticles, headingId, parseArticle } from "./articleData";
import { features } from "../features/featureData";

describe("article content contract", () => {
  it("selects translations per article and falls back without duplicating the catalogue", () => {
    const english = articles.filter(article => article.collection === "guides");
    const translation = { ...english[0], language: "it" as const, title: "Titolo italiano", topic: "Translated topic", body: "Testo italiano" };
    const catalogue = [...english, translation];
    const result = localizedArticles("guides", "it", catalogue);
    expect(result).toHaveLength(english.length);
    expect(result[0]).toMatchObject({ title: "Titolo italiano", body: "Testo italiano", topic: english[0].topic });
    expect(result[1]).toBe(english[1]);
    expect(localizedArticles("guides", "ja", catalogue)).toEqual(english);
    expect(articlePath(result[0])).toBe(`/it/guides/${english[0].slug}`);
    expect(articleJsonLd(result[0])).toMatchObject({ inLanguage: "it", mainEntityOfPage: `https://nanthai.tech/it/guides/${english[0].slug}` });
    expect(articleJsonLd(result[1], "it")).toMatchObject({ inLanguage: "en", mainEntityOfPage: `https://nanthai.tech/it/guides/${english[1].slug}` });
  });
  it("advertises only real translations, plus English and x-default", () => {
    const english = articles[0];
    const catalogue = [english, { ...english, language: "fr" as const }];
    const alternates = contentAlternates(english.collection, english.slug, catalogue);
    expect(alternates.map(alternate => alternate.language)).toEqual(["en", "fr", "x-default"]);
    expect(alternates[2].url).toBe(alternates[0].url);
    expect(contentAlternates("research").map(alternate => alternate.language)).toEqual(["en", "es", "fr", "de", "it", "ja", "zh", "x-default"]);
  });
  it("discovers every translation currently present using the shared parser", () => {
    for (const translation of allArticles.filter(article => article.language !== "en")) {
      expect(localizedArticles(translation.collection, translation.language).find(article => article.slug === translation.slug)).toMatchObject({ title: translation.title, body: translation.body, language: translation.language });
      expect(contentAlternates(translation.collection, translation.slug)).toContainEqual({ language: translation.language, url: `https://nanthai.tech${articlePath(translation)}` });
    }
    expect(parseArticle(`---\ntitle: 日本語\ndescription: 説明\nupdated: 2026-10-24\nrelated: [byok]\n---\n# 日本語\n\n本文`, "/guides/ja/example.md")).toMatchObject({ language: "ja", slug: "example", body: "本文" });
  });
  it("decodes quoted YAML metadata without displaying delimiters", () => {
    const source = `---\ntitle: "A title: with a colon"\ndescription: 'L''IA: une explication'\nupdated: "2026-10-24"\nrelated: ['byok', "memories"]\n---\n# A title: with a colon\n\nBody`;
    expect(parseArticle(source, "/guides/fr/example.md")).toMatchObject({ title: "A title: with a colon", description: "L'IA: une explication", updated: "2026-10-24", related: ["byok", "memories"], language: "fr" });
  });
  it("loads the ten guides and three original research articles", () => {
    expect(articles.filter(article => article.collection === "guides")).toHaveLength(10);
    expect(articles.filter(article => article.collection === "research")).toHaveLength(3);
    expect(new Set(articles.map(article => article.slug)).size).toBe(13);
  });
  it.each(articles.filter(article => article.collection === "guides"))("keeps $slug within the editorial contract", article => {
    expect(article.title.length).toBeLessThanOrEqual(60);
    expect(article.description.length).toBeLessThanOrEqual(155);
    const words = article.body.split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(600);
    expect(words).toBeLessThanOrEqual(1100);
    expect(article.body).not.toMatch(/^# /m);
    const links = [...new Set([...article.body.matchAll(/\]\((\/features\/[^)]+)\)/g)].map(match => match[1]))];
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links.length).toBeLessThanOrEqual(4);
    for (const related of article.related) {
      expect(features.some(feature => feature.slug === related)).toBe(true);
    }
  });
  it("retains publication dates separately from modification dates", () => {
    expect(articles.filter(article => article.collection === "research").map(article => article.published).sort()).toEqual(["2026-05-11", "2026-05-15", "2026-10-06"]);
    const article = articles[0];
    expect(articleJsonLd(article)).toMatchObject({ headline: article.title, datePublished: article.published, dateModified: article.updated, author: { name: "NanthAI" }, publisher: { name: "NanthAI" } });
  });
  it("rejects incomplete sources and removes only the redundant title", () => {
    expect(() => parseArticle("no frontmatter", "/guides/test.md")).toThrow("frontmatter");
    expect(headingId("What does **Pro** add?")).toBe("what-does-pro-add");
  });
});
