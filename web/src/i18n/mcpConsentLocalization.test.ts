import { expect, it } from "vitest";
import en from "./locales/en.json";
import itMessages from "./locales/it.json";
import de from "./locales/de.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";
import zh from "./locales/zh.json";

it("provides nonempty unverified-client and destination copy in all web locales", () => {
  for (const messages of [en, itMessages, de, es, fr, ja, zh]) {
    for (const key of ["external_mcp_unverified_app", "external_mcp_unverified_warning", "external_mcp_redirect_destination", "external_mcp_self_reported_name"] as const) {
      expect(messages[key].trim()).not.toHaveLength(0);
    }
  }
});
