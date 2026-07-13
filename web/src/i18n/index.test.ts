import { afterEach, describe, expect, it } from "vitest";
import { syncDocumentLanguage } from "./index";

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
});
