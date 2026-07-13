export const SHOW_CONSENT_PREFERENCES_EVENT = "nanthai:show-consent-preferences";

let preferencesRequested = false;

export function showConsentPreferences() {
  preferencesRequested = true;
  window.dispatchEvent(new Event(SHOW_CONSENT_PREFERENCES_EVENT));
}

export function consumeConsentPreferencesRequest(): boolean {
  const requested = preferencesRequested;
  preferencesRequested = false;
  return requested;
}
