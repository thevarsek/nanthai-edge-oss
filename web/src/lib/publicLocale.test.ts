import { describe, expect, it } from "vitest";
import { marketingPages } from "@/app-routing/marketingPages";
import { contentLanguages } from "./contentLocale";
import { marketingPaths } from "./marketingPaths";
import { preferredPublicPath, parsePublicPath, publicAlternates, publicPath } from "./publicLocale";

describe("public locale routing", () => {
  it("keeps the build catalogue and client route allowlist identical", () => {
    expect(marketingPages.map(page => page.path)).toEqual([...marketingPaths]);
  });
  it.each(contentLanguages)("round-trips all marketing pages in %s", language => {
    for (const path of marketingPaths) {
      const localized = publicPath(path, language);
      expect(parsePublicPath(localized)).toEqual({ path, language });
      expect(publicPath(`${localized}/`, "en")).toBe(path);
      expect(publicAlternates(path)).toHaveLength(8);
      expect(publicAlternates(path).at(-1)).toEqual({ language: "x-default", url: `https://nanthai.tech${path}` });
    }
  });
  it.each(["/app", "/app/chat/123", "/sign-in", "/settings", "/oauth/google/callback", "/api/test", "/openrouter/edge/callback", "/mcp/authorize", "/runtime/connect", "/mobile-drive-picker", "/en/features", "/pt/features", "/it/app", "/ja/sign-in", "/it/features/unknown"])("does not prefix or claim %s", path => {
    expect(parsePublicPath(path)).toBeUndefined();
    expect(publicPath(path, "ja")).toBe(path);
  });
  it("redirects only explicit preferences on English public URLs with a translation", () => {
    expect(preferredPublicPath("/", null)).toBeUndefined();
    expect(preferredPublicPath("/features/byok", null)).toBeUndefined();
    expect(preferredPublicPath("/features/byok", "it")).toBe("/it/features/byok");
    expect(preferredPublicPath("/guides", "it")).toBe("/it/guides");
    expect(preferredPublicPath("/ja/features/byok", "it")).toBeUndefined();
    expect(preferredPublicPath("/guides/example", "it", ["en", "de"])).toBeUndefined();
    expect(preferredPublicPath("/app", "it")).toBeUndefined();
  });
});
