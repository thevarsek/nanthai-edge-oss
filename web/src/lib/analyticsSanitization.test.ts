import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAllowedAnalyticsEnvironment,
  sanitizeExceptionUrlProperties,
} from "./analyticsSanitization";

describe("analyticsSanitization", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("removes dynamic identifiers and query data from exception URLs", () => {
    const properties = {
      $current_url: "https://nanthai.tech/app/chat/jd73zhf2n0f0rqkybj0g5mzqjn8a79js?token=secret",
      $pathname: "/app/chat/550e8400-e29b-41d4-a716-446655440000#private",
    };

    sanitizeExceptionUrlProperties(properties);

    expect(properties).toEqual({
      $current_url: "https://nanthai.tech/app/chat/:id",
      $pathname: "/app/chat/:id",
    });
  });

  it("blocks localhost when running as a production build", () => {
    vi.stubEnv("MODE", "production");
    vi.stubEnv("PROD", true);

    expect(window.location.hostname).toBe("localhost");
    expect(isAllowedAnalyticsEnvironment()).toBe(false);
  });
});
