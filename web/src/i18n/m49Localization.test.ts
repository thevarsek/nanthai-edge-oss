import { describe, expect, it } from "vitest";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import itMessages from "./locales/it.json";
import ja from "./locales/ja.json";
import zh from "./locales/zh.json";

const explicitKeys = [
  "back_to_settings",
  "optional",
  "tool_is_running",
  "tool_returned_error",
  "completed_successfully",
  "unavailable_integration",
  "skill_uses_documents",
  "skill_uses_data_analysis",
  "skill_uses_coding_workspace",
  "feature_title_remote_mcp",
];

const m49Keys = Object.keys(en).filter((key) =>
  key.startsWith("remote_mcp_") || key.startsWith("mcp_") || explicitKeys.includes(key),
);
const locales = { de, es, fr, it: itMessages, ja, zh } as const;
const placeholders = (value: string) => [...value.matchAll(/\{\{([^}]+)\}\}/g)]
  .map((match) => match[1])
  .sort();

describe("M49 web localization", () => {
  it("provides every M49 key and interpolation in every supported locale", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      for (const key of m49Keys) {
        const translated = messages[key as keyof typeof messages];
        expect(translated, `${locale}:${key}`).toBeTypeOf("string");
        expect(translated, `${locale}:${key}`).not.toHaveLength(0);
        expect(placeholders(translated), `${locale}:${key}`).toEqual(placeholders(en[key as keyof typeof en]));
      }
    }
  });

  it("keeps the public Remote MCP feature copy in the localized contract", () => {
    expect(m49Keys).toEqual(expect.arrayContaining([
      "feature_title_remote_mcp",
      "mcp_seo_desc",
      "mcp_step1_title",
      "mcp_cap_tasks_desc",
      "mcp_compatibility_desc_after",
      "mcp_scenario_4",
    ]));
  });
});
