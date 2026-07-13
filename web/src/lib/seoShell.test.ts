import { beforeEach, describe, expect, it } from "vitest";
import { isPublicSeoPath, removeBuildTimeSeoShell } from "./seoShell";

describe("build-time SEO shell cleanup", () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <title>NanthAI Edge | AI Workspace</title>
      <meta name="description" content="Build-time description" />
      <meta name="theme-color" content="#000000" />
      <link rel="canonical" href="https://nanthai.tech/" />
    `;
  });

  it("removes stale SEO metadata before React renders a public route", () => {
    removeBuildTimeSeoShell("/features/search");

    expect(document.querySelector("title")).toBeNull();
    expect(document.querySelector('meta[name="description"]')).toBeNull();
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('meta[name="theme-color"]')).toBeInTheDocument();
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
    expect(isPublicSeoPath("/sign-in")).toBe(false);
  });
});
