import { describe, expect, it } from "vitest";
import { getToolIconName, getToolName } from "./toolCallDisplay";

const translations: Record<string, string> = {
  read_document: "Leggi documento",
  read_pdf: "Leggi PDF",
};

describe("document reader tool presentation", () => {
  it("uses localized aliases for each document reader tool ID", () => {
    const translate = (key: string) => translations[key] ?? key;

    expect(getToolName("read_docx", translate)).toBe("Leggi documento");
    expect(getToolName("read_document", translate)).toBe("Leggi documento");
    expect(getToolName("read_pdf", translate)).toBe("Leggi PDF");
  });

  it("uses document icons while retaining the unknown-tool fallback", () => {
    expect(getToolIconName("read_docx")).toBe("document");
    expect(getToolIconName("read_document")).toBe("document");
    expect(getToolIconName("read_pdf")).toBe("document");
    expect(getToolIconName("future_tool")).toBeNull();
    expect(getToolName("future_tool")).toBe("Future Tool");
  });
});
