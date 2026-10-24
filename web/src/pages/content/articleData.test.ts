import { describe, expect, it } from "vitest";
import { articles, articleJsonLd, headingId, parseArticle } from "./articleData";
import { features } from "../features/featureData";

describe("article content contract", () => {
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
