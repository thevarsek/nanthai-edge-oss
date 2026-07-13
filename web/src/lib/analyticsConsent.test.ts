import { beforeEach, describe, expect, it, vi } from "vitest";

describe("analytics consent", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it("defaults to no collection when no choice has been stored", async () => {
    const { getAnalyticsConsent } = await import("./analyticsConsent");

    expect(getAnalyticsConsent()).toEqual({
      analytics: false,
      decided: false,
      sessionReplay: false,
    });
  });

  it("restores a current accepted preference for direct app visits", async () => {
    window.localStorage.setItem("nanthai_consent", JSON.stringify({
      categories: ["necessary", "analytics", "session_replay"],
      revision: 1,
    }));

    const { getAnalyticsConsent } = await import("./analyticsConsent");

    expect(getAnalyticsConsent()).toEqual({
      analytics: true,
      decided: true,
      sessionReplay: true,
    });
  });

  it("does not trust an obsolete consent revision", async () => {
    window.localStorage.setItem("nanthai_consent", JSON.stringify({
      categories: ["necessary", "analytics"],
      revision: 0,
    }));

    const { getAnalyticsConsent } = await import("./analyticsConsent");

    expect(getAnalyticsConsent().analytics).toBe(false);
    expect(getAnalyticsConsent().decided).toBe(false);
  });

  it.each([
    ["/", true],
    ["/privacy", true],
    ["/features/search", true],
    ["/app", false],
    ["/chat/abc", false],
    ["/sign-in", false],
    ["/onboarding", false],
    ["/openrouter/callback", false],
  ])("classifies %s as public consent UI route: %s", async (path, expected) => {
    const { isPublicConsentRoute } = await import("./analyticsConsent");

    expect(isPublicConsentRoute(path)).toBe(expected);
  });
});
