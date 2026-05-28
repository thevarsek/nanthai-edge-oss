import { render } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { beforeEach, describe, expect, it } from "vitest";
import { Seo } from "./Seo";
import { buildBreadcrumbsJsonLd, buildOrganizationJsonLd } from "@/lib/seo";

function metaContent(selector: string) {
  return document.querySelector(selector)?.getAttribute("content");
}

describe("Seo", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  it("generates canonical title, description, social, and keyword metadata", () => {
    render(
      <HelmetProvider>
        <Seo
          title="Feature Title | NanthAI Edge"
          description="Feature description"
          url="https://nanthai.tech/features/search?ref=share"
          canonical="https://nanthai.tech/features/search"
          image="https://nanthai.tech/feature.png"
          keywords={["AI search", "research"]}
        />
      </HelmetProvider>,
    );

    expect(document.title).toBe("Feature Title | NanthAI Edge");
    expect(metaContent('meta[name="description"]')).toBe("Feature description");
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute("href", "https://nanthai.tech/features/search");
    expect(metaContent('meta[name="keywords"]')).toBe("AI search, research");
    expect(metaContent('meta[property="og:url"]')).toBe("https://nanthai.tech/features/search?ref=share");
    expect(metaContent('meta[property="og:image"]')).toBe("https://nanthai.tech/feature.png");
    expect(metaContent('meta[name="twitter:title"]')).toBe("Feature Title | NanthAI Edge");
  });

  it("falls back to URL as canonical and builds structured data helpers", () => {
    render(
      <HelmetProvider>
        <Seo title="Fallback" description="Fallback description" url="https://nanthai.tech/fallback" />
      </HelmetProvider>,
    );

    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute("href", "https://nanthai.tech/fallback");
    expect(buildOrganizationJsonLd({ name: "NanthAI", url: "https://nanthai.tech", logoUrl: "https://nanthai.tech/logo.png" })).toMatchObject({
      "@type": "Organization",
      logo: { "@type": "ImageObject", url: "https://nanthai.tech/logo.png" },
    });
    expect(buildBreadcrumbsJsonLd([
      { name: "Home", url: "https://nanthai.tech" },
      { name: "Features", url: "https://nanthai.tech/features" },
    ])).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, name: "Home" },
        { position: 2, name: "Features" },
      ],
    });
  });
});
