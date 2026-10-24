import { expect, it } from "vitest";
import fr from "./locales/fr.json";

it("uses Réglages for app settings while retaining technical model parameters", () => {
  for (const value of [fr.settings, fr.settings_title, fr.back_to_settings, fr.you_can_replay_from_settings,
    fr.connect_integrations_in_settings, fr.upload_files_in_settings_kb, fr.create_skills_in_settings,
    fr.connect_accounts_message, fr.media_notice_openrouter_required]) {
    expect(value).toContain("Réglages");
    expect(value).not.toContain("Paramètres");
  }
  expect(fr.active_parameters).toBe("Paramètres actifs");
  expect(fr.model_settings).toBe("Paramètres du modèle");
  expect(fr.parameter_overrides).toContain("paramètres");
});
