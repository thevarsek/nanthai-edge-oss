import { beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: posthog,
}));

describe("analytics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_project_token");
    posthog.init.mockReset();
    posthog.identify.mockReset();
    posthog.captureException.mockReset();
  });

  it("identifies PostHog users with only the pseudonymous analytics ID", async () => {
    const { identifyAnalyticsUser, initAnalytics } = await import("./analytics");

    initAnalytics();
    identifyAnalyticsUser("aid_test_123");

    expect(posthog.identify).toHaveBeenCalledWith("aid_test_123", {
      platform: "web",
      surface: "web_app",
    });
    expect(JSON.stringify(posthog.identify.mock.calls)).not.toContain("user_1");
    expect(JSON.stringify(posthog.identify.mock.calls)).not.toContain("ada@example.com");
    expect(JSON.stringify(posthog.identify.mock.calls)).not.toContain("Ada Lovelace");
  });

  it("redacts raw exception messages before sending them to PostHog", async () => {
    const { captureAnalyticsException, initAnalytics } = await import("./analytics");

    initAnalytics();
    captureAnalyticsException(new Error("secret prompt fragment"), {
      boundary_level: "app",
      error_label: "caller supplied secret prompt fragment",
    });

    expect(posthog.captureException).toHaveBeenCalledTimes(1);
    const [error, properties] = posthog.captureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(error.name).toBe("Error");
    expect(error.message).toBe("redacted");
    expect(properties).toMatchObject({
      boundary_level: "app",
      error_label: "error",
    });
    expect(JSON.stringify(posthog.captureException.mock.calls)).not.toContain("secret prompt fragment");
  });
});
