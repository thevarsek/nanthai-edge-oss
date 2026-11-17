import { expect, it } from "vitest";
import en from "./locales/en.json";
import itMessages from "./locales/it.json";
import de from "./locales/de.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";
import zh from "./locales/zh.json";

const keys = Object.keys(en).filter((key) => key.startsWith("tool_confirmation_"));

it("localizes every tool confirmation string in all web locales", () => {
  expect(keys.length).toBeGreaterThanOrEqual(15);
  for (const messages of [itMessages, de, es, fr, ja, zh] as Array<Record<string, string>>) {
    for (const key of keys) expect(messages[key]?.trim(), key).toBeTruthy();
    expect(messages.tool_confirmation_countdown).toContain("{{time}}");
  }
});
