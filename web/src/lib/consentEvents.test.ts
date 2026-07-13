import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeConsentPreferencesRequest,
  SHOW_CONSENT_PREFERENCES_EVENT,
  showConsentPreferences,
} from "./consentEvents";

describe("consent preference events", () => {
  beforeEach(() => {
    consumeConsentPreferencesRequest();
  });

  it("buffers a request until the lazy consent manager is ready", () => {
    const listener = vi.fn();
    window.addEventListener(SHOW_CONSENT_PREFERENCES_EVENT, listener);

    showConsentPreferences();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(consumeConsentPreferencesRequest()).toBe(true);
    expect(consumeConsentPreferencesRequest()).toBe(false);
    window.removeEventListener(SHOW_CONSENT_PREFERENCES_EVENT, listener);
  });
});
