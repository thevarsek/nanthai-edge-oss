import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  convertPlaceholders,
  decodeXmlEntities,
} = require("../../scripts/convert-android-strings.cjs") as {
  convertPlaceholders: (value: string) => string;
  decodeXmlEntities: (value: string) => string;
};

describe("convert-android-strings", () => {
  it("keeps escaped percent placeholders literal while converting real placeholders", () => {
    expect(convertPlaceholders("literal %%")).toBe("literal %");
    expect(convertPlaceholders("literal %%s and %%d")).toBe("literal %s and %d");
    expect(convertPlaceholders("hello %s %1$d %2$.2f")).toBe("hello {{var1}} {{var1}} {{var2}}");
  });

  it("decodes exactly one layer of XML entities", () => {
    expect(decodeXmlEntities("Use &lt;tag&gt;")).toBe("Use <tag>");
    expect(decodeXmlEntities("Use &amp;lt;tag&amp;gt;")).toBe("Use &lt;tag&gt;");
    expect(decodeXmlEntities("Keep &amp;amp; literal")).toBe("Keep &amp; literal");
  });
});
