import { describe, expect, it } from "vitest";
import { getToolIconName, getToolName, skillSummary } from "./toolCallDisplay";

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

describe("skill tool presentation", () => {
  it("humanizes load-skill slugs but preserves explicit display-name casing", () => {
    const load = skillSummary({
      id: "call_1",
      name: "load_skill",
      arguments: JSON.stringify({ name: "image-generation" }),
    });
    const update = skillSummary({
      id: "call_2",
      name: "update_skill",
      arguments: JSON.stringify({ skillName: "iOS QA" }),
    });
    const create = skillSummary({
      id: "call_3",
      name: "create_skill",
      arguments: JSON.stringify({ name: "eBay research" }),
    });

    expect(load?.title).toBe("Load Image Generation");
    expect(update?.title).toBe("Update iOS QA");
    expect(create?.title).toBe("Create eBay research");
  });
});
