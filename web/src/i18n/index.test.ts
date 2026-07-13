import { afterEach, describe, expect, it } from "vitest";
import i18n, { initialization, syncDocumentLanguage } from "./index";

describe("syncDocumentLanguage", () => {
  afterEach(() => {
    document.documentElement.lang = "en";
  });

  it("normalizes supported regional languages for the document", () => {
    syncDocumentLanguage("it-IT");

    expect(document.documentElement.lang).toBe("it");
  });

  it("falls back to English for unsupported or missing languages", () => {
    syncDocumentLanguage("pt-BR");
    expect(document.documentElement.lang).toBe("en");

    syncDocumentLanguage(undefined);
    expect(document.documentElement.lang).toBe("en");
  });

  it("loads a non-English translation bundle when that language is selected", async () => {
    await initialization;
    expect(i18n.hasResourceBundle("it", "translation")).toBe(false);

    await i18n.changeLanguage("it");

    expect(i18n.hasResourceBundle("it", "translation")).toBe(true);
    expect(document.documentElement.lang).toBe("it");
    await i18n.changeLanguage("en");
  });
});
