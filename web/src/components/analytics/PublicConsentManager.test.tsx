import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PublicConsentManager from "./PublicConsentManager";
import { showConsentPreferences } from "@/lib/consentEvents";

const consent = vi.hoisted(() => ({
  acceptedCategory: vi.fn(),
  hide: vi.fn(),
  hidePreferences: vi.fn(),
  run: vi.fn(),
  show: vi.fn(),
  showPreferences: vi.fn(),
  validConsent: vi.fn(),
}));
const analytics = vi.hoisted(() => ({ applyAnalyticsConsent: vi.fn() }));
const consentState = vi.hoisted(() => ({ setAnalyticsConsent: vi.fn() }));

vi.mock("vanilla-cookieconsent", () => consent);
vi.mock("@/lib/analytics", () => analytics);
vi.mock("@/lib/analyticsConsent", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/analyticsConsent")>(),
  setAnalyticsConsent: consentState.setAnalyticsConsent,
}));

describe("PublicConsentManager", () => {
  beforeEach(() => {
    for (const mock of Object.values(consent)) mock.mockReset();
    analytics.applyAnalyticsConsent.mockReset();
    consentState.setAnalyticsConsent.mockReset();
    consent.run.mockResolvedValue(undefined);
    consent.validConsent.mockReturnValue(true);
  });

  it("uses explicit opt-in with separate analytics and replay categories", async () => {
    render(<PublicConsentManager />);

    await waitFor(() => expect(consent.run).toHaveBeenCalledTimes(1));
    const config = consent.run.mock.calls[0][0];
    expect(config).toMatchObject({
      mode: "opt-in",
      revision: 1,
      cookie: { name: "nanthai_consent", useLocalStorage: true },
      categories: {
        necessary: { enabled: true, readOnly: true },
        analytics: expect.any(Object),
        session_replay: expect.any(Object),
      },
    });
  });

  it("enables replay only when analytics and replay are both accepted", async () => {
    consent.acceptedCategory.mockImplementation((category: string) => (
      category === "analytics" || category === "session_replay"
    ));
    render(<PublicConsentManager />);
    await waitFor(() => expect(consent.run).toHaveBeenCalledTimes(1));

    consent.run.mock.calls[0][0].onConsent();

    expect(consentState.setAnalyticsConsent).toHaveBeenCalledWith({
      analytics: true,
      decided: true,
      sessionReplay: true,
    });
    expect(analytics.applyAnalyticsConsent).toHaveBeenCalledWith({
      analytics: true,
      decided: true,
      sessionReplay: true,
    });
  });

  it("hides both consent surfaces when leaving the public website", async () => {
    const view = render(<PublicConsentManager />);
    await waitFor(() => expect(consent.run).toHaveBeenCalledTimes(1));

    view.unmount();

    expect(consent.hide).toHaveBeenCalled();
    expect(consent.hidePreferences).toHaveBeenCalled();
  });

  it("re-shows an undecided prompt after returning from an app route", async () => {
    consent.validConsent.mockReturnValue(false);
    render(<PublicConsentManager />);

    await waitFor(() => expect(consent.show).toHaveBeenCalledWith(true));
  });

  it("opens a preference request made before the lazy manager is ready", async () => {
    showConsentPreferences();
    render(<PublicConsentManager />);

    await waitFor(() => expect(consent.showPreferences).toHaveBeenCalledTimes(1));
  });
});
