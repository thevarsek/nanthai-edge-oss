import { beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({
  _isIdentified: vi.fn(),
  capture: vi.fn(),
  captureException: vi.fn(),
  has_opted_out_capturing: vi.fn(),
  identify: vi.fn(),
  init: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  reset: vi.fn(),
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: posthog }));

function storeConsent(categories = ["necessary", "analytics"]) {
  window.localStorage.setItem("nanthai_consent", JSON.stringify({ categories, revision: 1 }));
}

describe("analytics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_project_token");
    window.localStorage.clear();
    storeConsent();
    for (const mock of Object.values(posthog)) mock.mockReset();
    posthog.has_opted_out_capturing.mockReturnValue(false);
  });

  it("does not load PostHog before analytics consent", async () => {
    window.localStorage.clear();
    const { initAnalytics } = await import("./analytics");

    expect(await initAnalytics()).toBe(false);
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it("identifies users with only the pseudonymous analytics ID", async () => {
    const { identifyAnalyticsUser, initAnalytics } = await import("./analytics");

    await initAnalytics();
    identifyAnalyticsUser("aid_test_123");

    await vi.waitFor(() => {
      expect(posthog.identify).toHaveBeenCalledWith("aid_test_123", {
        platform: "web",
        surface: "web_app",
      });
    });
    expect(JSON.stringify(posthog.identify.mock.calls)).not.toContain("user_1");
    expect(JSON.stringify(posthog.identify.mock.calls)).not.toContain("ada@example.com");
  });

  it("captures sanitized standard pageviews while preserving campaign properties", async () => {
    const { capturePageview, initAnalytics } = await import("./analytics");

    await initAnalytics();
    capturePageview("/features/search?secret=value#fragment", true);

    await vi.waitFor(() => {
      expect(posthog.capture).toHaveBeenCalledWith(
        "$pageview",
        expect.objectContaining({
          $current_url: "http://localhost:3000/features/search",
          $pathname: "/features/search",
          path: "/features/search",
          search_present: true,
        }),
      );
    });
  });

  it("redacts raw exception messages before sending them to PostHog", async () => {
    const { captureAnalyticsException, initAnalytics } = await import("./analytics");

    await initAnalytics();
    captureAnalyticsException(new Error("secret prompt fragment"), {
      boundary_level: "app",
      error_label: "caller supplied secret prompt fragment",
    });

    await vi.waitFor(() => expect(posthog.captureException).toHaveBeenCalledTimes(1));
    const [error, properties] = posthog.captureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(error).toMatchObject({ name: "Error", message: "redacted" });
    expect(properties).toMatchObject({ boundary_level: "app", error_label: "error" });
    expect(JSON.stringify(posthog.captureException.mock.calls)).not.toContain("secret prompt fragment");
  });

  it("keeps session replay disabled unless it has separate consent", async () => {
    const { initAnalytics } = await import("./analytics");

    await initAnalytics();

    expect(posthog.stopSessionRecording).toHaveBeenCalled();
    expect(posthog.startSessionRecording).not.toHaveBeenCalled();
  });
});
