import { describe, expect, it } from "vitest";

import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import itMessages from "./locales/it.json";
import ja from "./locales/ja.json";
import zh from "./locales/zh.json";

const m45Keys = Object.keys(en).filter((key) =>
  key.startsWith("local_runtime_")
  || key.startsWith("persona_runtime_")
  || key.startsWith("runtime_permission_")
  || key.startsWith("runtime_status_")
  || key.startsWith("runtime_route_")
  || key.startsWith("runtime_native_agent_")
  || key === "runtime_last_seen"
  || key === "runtime_remove_pairing"
  || key === "collapse_subagent_details"
  || key === "expand_subagent_details",
);
const locales = { de, es, fr, it: itMessages, ja, zh } as const;
const placeholders = (value: string) => [...value.matchAll(/\{\{([^}]+)\}\}/g)]
  .map((match) => match[1])
  .sort();

describe("M45 web localization", () => {
  it("explains the bounded allow-session scope", () => {
    expect(en.runtime_permission_allow_session_help).toBe(
      "Applies within this active Codex session, but Codex may still ask about other actions. Future turns may ask again.",
    );
  });

  it("keeps Runtime Host copy and interpolation in every supported locale", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      for (const key of m45Keys) {
        const translated = messages[key as keyof typeof messages];
        expect(translated, `${locale}:${key}`).toBeTypeOf("string");
        expect(translated, `${locale}:${key}`).not.toHaveLength(0);
        expect(placeholders(translated), `${locale}:${key}`)
          .toEqual(placeholders(en[key as keyof typeof en]));
      }
    }
  });
});
