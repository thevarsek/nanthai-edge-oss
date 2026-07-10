import { describe, expect, it } from "vitest";
import { displayMessageContent } from "./persistedGenerationError";

function failedAssistant(content: string) {
  return { role: "assistant", status: "failed", content };
}

describe("displayMessageContent", () => {
  it("extracts the screenshot-shaped root message", () => {
    const raw = "Error:\n{\"code\":\"INTERNAL_ERROR\",\"message\":\"OpenRouter API error (500): Internal Server Error\"}";

    expect(displayMessageContent(failedAssistant(raw)))
      .toBe("OpenRouter API error (500): Internal Server Error");
  });

  it("recursively extracts nested data and JSON strings", () => {
    const nested = JSON.stringify({ data: { data: { message: "Nested provider failure" } } });
    const raw = `Error: ${JSON.stringify({ error: nested })}`;

    expect(displayMessageContent(failedAssistant(raw))).toBe("Nested provider failure");
  });

  it("preserves plain and malformed fallback content", () => {
    const plain = "Error: Provider unavailable";
    const malformed = "Error: {not-json";
    const array = "Error: [{\"message\":\"Unsupported array shape\"}]";

    expect(displayMessageContent(failedAssistant(plain))).toBe(plain);
    expect(displayMessageContent(failedAssistant(malformed))).toBe(malformed);
    expect(displayMessageContent(failedAssistant(array))).toBe(array);
  });

  it("never reinterprets non-failed JSON content", () => {
    const raw = "Error: {\"message\":\"This is quoted example content\"}";

    expect(displayMessageContent({ role: "assistant", status: "completed", content: raw })).toBe(raw);
    expect(displayMessageContent({ role: "user", status: "failed", content: raw })).toBe(raw);
  });
});
