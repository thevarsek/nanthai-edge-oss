const CONSENT_STORAGE_KEY = "nanthai_consent";
export const CONSENT_REVISION = 1;

export type AnalyticsConsent = {
  analytics: boolean;
  decided: boolean;
  sessionReplay: boolean;
};

const NO_CONSENT: AnalyticsConsent = {
  analytics: false,
  decided: false,
  sessionReplay: false,
};

type StoredConsent = {
  categories?: unknown;
  revision?: unknown;
};

function readStoredConsent(): AnalyticsConsent {
  if (typeof window === "undefined") return NO_CONSENT;

  try {
    const rawConsent = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!rawConsent) return NO_CONSENT;

    const stored = JSON.parse(rawConsent) as StoredConsent;
    if (stored.revision !== CONSENT_REVISION || !Array.isArray(stored.categories)) {
      return NO_CONSENT;
    }

    const categories = stored.categories.filter(
      (category): category is string => typeof category === "string",
    );
    return {
      analytics: categories.includes("analytics"),
      decided: true,
      sessionReplay: categories.includes("session_replay"),
    };
  } catch {
    return NO_CONSENT;
  }
}

let currentConsent = readStoredConsent();
const listeners = new Set<() => void>();

export function getAnalyticsConsent(): AnalyticsConsent {
  return currentConsent;
}

export function setAnalyticsConsent(consent: AnalyticsConsent) {
  if (
    currentConsent.analytics === consent.analytics
    && currentConsent.decided === consent.decided
    && currentConsent.sessionReplay === consent.sessionReplay
  ) {
    return;
  }

  currentConsent = consent;
  for (const listener of listeners) listener();
}

export function subscribeAnalyticsConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isPublicConsentRoute(pathname: string): boolean {
  return pathname === "/"
    || pathname === "/privacy"
    || pathname === "/terms"
    || pathname === "/support"
    || pathname === "/licensing"
    || pathname === "/features"
    || pathname.startsWith("/features/");
}

export { CONSENT_STORAGE_KEY };
