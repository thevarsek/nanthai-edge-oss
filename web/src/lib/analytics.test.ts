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

  it("sends structured exception diagnostics without raw messages", async () => {
    const { captureAnalyticsException, initAnalytics } = await import("./analytics");

    const originalError = new TypeError("secret prompt fragment");
    originalError.stack = [
      "TypeError: secret prompt fragment",
      "    at renderWidget (https://nanthai.tech/assets/app.js?secret=value:10:2)",
    ].join("\n");
    await initAnalytics();
    captureAnalyticsException(originalError, {
      boundaryLevel: "app",
      featureArea: "error_boundary",
      hasComponentStack: true,
      operation: "react_render",
    });

    await vi.waitFor(() => expect(posthog.captureException).toHaveBeenCalledTimes(1));
    const [error, properties] = posthog.captureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(error).toMatchObject({ name: "TypeError", message: "react_render.type_error" });
    expect(error.stack).toContain("at renderWidget (https://nanthai.tech/assets/app.js");
    expect(properties).toMatchObject({
      boundary_level: "app",
      error_category: "type_error",
      error_label: "type_error",
      error_message_redacted: true,
      error_type: "TypeError",
      feature_area: "error_boundary",
      has_component_stack: true,
      operation: "react_render",
    });
    expect(JSON.stringify(posthog.captureException.mock.calls)).not.toContain("secret prompt fragment");
    expect(JSON.stringify(posthog.captureException.mock.calls)).not.toContain("secret=value");
  });

  it("keeps session replay disabled unless it has separate consent", async () => {
    const { initAnalytics } = await import("./analytics");

    await initAnalytics();

    expect(posthog.stopSessionRecording).toHaveBeenCalled();
    expect(posthog.startSessionRecording).not.toHaveBeenCalled();
  });
});
