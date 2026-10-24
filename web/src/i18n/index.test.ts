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
    // The public URL owns document language; app detection must not overwrite it.
    expect(document.documentElement.lang).toBe("en");
    await i18n.changeLanguage("en");
  });

  it("localizes the static skip link when the UI language changes", async () => {
    await initialization;
    const link = document.createElement("a");
    link.id = "skip-to-content";
    document.body.append(link);
    await i18n.changeLanguage("it");
    syncDocumentLanguage("it");
    expect(link).toHaveTextContent("Vai al contenuto principale");
    await i18n.changeLanguage("en");
    syncDocumentLanguage("en");
    expect(link).toHaveTextContent("Skip to main content");
    link.remove();
  });
});
