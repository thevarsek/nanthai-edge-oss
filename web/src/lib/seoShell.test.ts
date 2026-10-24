import { beforeEach, describe, expect, it } from "vitest";
import { isPublicSeoPath, removeBuildTimeSeoShell } from "./seoShell";

describe("build-time SEO shell cleanup", () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <title data-seo-shell="true">NanthAI Edge | AI Workspace</title>
      <meta name="description" content="Build-time description" data-seo-shell="true" />
      <meta name="theme-color" content="#000000" />
      <link rel="canonical" href="https://nanthai.tech/" data-seo-shell="true" />
    `;
  });

  it("removes stale SEO metadata before React renders a public route", () => {
    removeBuildTimeSeoShell("/features/search");

    expect(document.querySelector("title")).toBeNull();
    expect(document.querySelector('meta[name="description"]')).toBeNull();
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('meta[name="theme-color"]')).toBeInTheDocument();
  });

  it("cleans the language alternates when entering a localised route", () => {
    document.head.insertAdjacentHTML("beforeend", '<link rel="alternate" hreflang="it" href="https://nanthai.tech/it/guides" data-seo-shell="true" />');
    removeBuildTimeSeoShell("/it/guides");
    expect(document.querySelector('link[hreflang]')).toBeNull();
  });

  it("preserves the fallback metadata on private application routes", () => {
    removeBuildTimeSeoShell("/app");

    expect(document.title).toBe("NanthAI Edge | AI Workspace");
    expect(document.querySelector('meta[name="description"]')).toBeInTheDocument();
  });

  it("recognizes every public metadata route family", () => {
    expect(isPublicSeoPath("/")).toBe(true);
    expect(isPublicSeoPath("/privacy")).toBe(true);
    expect(isPublicSeoPath("/features")).toBe(true);
    expect(isPublicSeoPath("/features/byok")).toBe(true);
    expect(isPublicSeoPath("/guides")).toBe(true);
    expect(isPublicSeoPath("/guides/ai-chat-memory")).toBe(true);
    expect(isPublicSeoPath("/research")).toBe(true);
    expect(isPublicSeoPath("/research/beyond-the-transcript")).toBe(true);
    expect(isPublicSeoPath("/workflows")).toBe(true);
    expect(isPublicSeoPath("/local-runtime")).toBe(true);
    expect(isPublicSeoPath("/research/results")).toBe(true);
    expect(isPublicSeoPath("/research/methods")).toBe(true);
    expect(isPublicSeoPath("/sign-in")).toBe(false);
    expect(isPublicSeoPath("/it/guides/ai-chat-memory")).toBe(true);
    expect(isPublicSeoPath("/zh/research/")).toBe(true);
    expect(isPublicSeoPath("/it/features")).toBe(false);
  });
});
