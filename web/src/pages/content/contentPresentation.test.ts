import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en.json";
import { articleDate } from "./contentPresentation";

const locales = import.meta.glob<Record<string, string>>("../../i18n/locales/*.json", { eager: true, import: "default" });
const chromeKeys = Object.keys(en).filter(key => key.startsWith("content_") || ["edge_nav_guides", "edge_nav_research_articles"].includes(key));

describe("localised article chrome", () => {
  it.each(Object.entries(locales))("has the complete chrome in %s", (_file, locale) => {
    for (const key of chromeKeys) {
      expect(locale[key], key).toBeTruthy();
      expect(locale[key].match(/{{\w+}}/g) ?? [], key).toEqual(en[key as keyof typeof en].match(/{{\w+}}/g) ?? []);
    }
  });
  it("formats publication and update dates in the requested language", () => {
    expect(articleDate("2026-10-24", "it")).toBe("24 ottobre 2026");
    expect(articleDate("2026-10-24", "en")).toBe("24 October 2026");
    expect(articleDate("2026-10-24", "ja")).toContain("2026年10月24日");
  });
});
