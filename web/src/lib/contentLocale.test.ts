import { describe, expect, it } from "vitest";
import { contentLanguage, contentLanguages, contentPath, localizeContentPath, parseContentPath } from "./contentLocale";

it.each(contentLanguages)("round-trips %s content URLs without changing slugs", language => {
  for (const collection of ["guides", "research"] as const) {
    for (const slug of [undefined, "ai-chat-memory"]) {
      const url = contentPath(collection, language, slug);
      expect(parseContentPath(`${url}/`)).toEqual({ language, collection, slug });
      expect(localizeContentPath(url, "en")).toBe(contentPath(collection, "en", slug));
    }
  }
});

describe("content-only URL localisation", () => {
  it.each(["/", "/features/byok", "/app", "/workflows", "/it/features", "/pt/guides"])("preserves %s", path => {
    expect(parseContentPath(path)).toBeUndefined();
    expect(localizeContentPath(path, "ja")).toBe(path);
  });
  it("normalizes regional language choices", () => {
    expect(contentLanguage("IT-it")).toBe("it");
    expect(contentLanguage("zh-CN")).toBe("zh");
    expect(contentLanguage("pt")).toBe("en");
  });
});
