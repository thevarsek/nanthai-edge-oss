import { describe, expect, it, vi } from "vitest";
import { readOAuthContext } from "./providerOAuth";

describe("providerOAuth context", () => {
  it("clears and ignores stale callback context", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T00:00:00Z"));
    localStorage.setItem("nanthai.oauth.google", JSON.stringify({
      state: "old_state",
      verifier: "verifier",
      redirectUri: "https://example.com/oauth/google/callback",
      createdAt: Date.now() - 11 * 60 * 1000,
      requestedIntegration: "drive",
    }));

    expect(readOAuthContext("google")).toBeNull();
    expect(localStorage.getItem("nanthai.oauth.google")).toBeNull();

    vi.useRealTimers();
  });
});
