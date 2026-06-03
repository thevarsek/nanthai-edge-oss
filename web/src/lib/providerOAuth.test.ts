import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProviderAuthorizationUrl, connectProviderWithPopup, readOAuthContext } from "./providerOAuth";

function stubOAuthCrypto(digest: () => Promise<ArrayBuffer> = async () => new Uint8Array(32).buffer) {
  vi.stubGlobal("crypto", {
    getRandomValues: (bytes: Uint8Array) => {
      bytes.fill(7);
      return bytes;
    },
    subtle: { digest },
  });
}

function popupStub() {
  return {
    document: {
      title: "",
      body: { innerHTML: "" },
    },
    location: { href: "" },
    close: vi.fn(),
  };
}

describe("providerOAuth context", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  });

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
  });

  it("opens the popup synchronously before async authorization URL work completes", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "google_client");
    let resolveDigest: (value: ArrayBuffer) => void = () => {};
    stubOAuthCrypto(() => new Promise((resolve) => {
      resolveDigest = resolve;
    }));
    const popup = popupStub();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

    const connection = connectProviderWithPopup("google", { requestedIntegration: "drive" });

    expect(window.open).toHaveBeenCalledWith("", "oauth-popup", "width=600,height=700,menubar=no,toolbar=no");
    expect(popup.document.title).toBe("Connecting Google...");
    expect(popup.location.href).toBe("");

    resolveDigest(new Uint8Array(32).buffer);
    await vi.waitFor(() => {
      expect(popup.location.href).toContain("https://accounts.google.com/o/oauth2/v2/auth?");
    });
    const state = readOAuthContext("google")?.state ?? "";
    expect(state).not.toBe("");

    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: { type: "nanthai-oauth-result", provider: "google", state, success: true },
    }));

    await expect(connection).resolves.toBeUndefined();
  });

  it("builds Slack authorization URLs with a stored PKCE verifier", async () => {
    vi.stubEnv("VITE_SLACK_CLIENT_ID", "slack_client");
    stubOAuthCrypto();

    const authUrl = await buildProviderAuthorizationUrl("slack");
    const url = new URL(authUrl);
    const context = readOAuthContext("slack");

    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2_user/authorize");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(context?.state);
    expect(context?.verifier).toBeTruthy();
  });

  it("clears context and rejects when the popup is blocked", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "google_client");
    localStorage.setItem("nanthai.oauth.google", JSON.stringify({
      state: "state",
      verifier: "verifier",
      redirectUri: "https://example.com/oauth/google/callback",
      createdAt: Date.now(),
    }));
    vi.spyOn(window, "open").mockReturnValue(null);

    await expect(connectProviderWithPopup("google")).rejects.toThrow("Popup blocked");

    expect(localStorage.getItem("nanthai.oauth.google")).toBeNull();
  });

  it("closes the popup and clears context when authorization URL creation fails", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    stubOAuthCrypto();
    const popup = popupStub();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

    await expect(connectProviderWithPopup("google")).rejects.toThrow("Google OAuth is not configured for web.");

    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("nanthai.oauth.google")).toBeNull();
  });

  it("ignores unrelated popup messages and rejects on timeout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "google_client");
    stubOAuthCrypto();
    vi.spyOn(window, "open").mockReturnValue(popupStub() as unknown as Window);

    const connection = connectProviderWithPopup("google");
    await vi.waitFor(() => {
      expect(localStorage.getItem("nanthai.oauth.google")).not.toBeNull();
    });
    const state = readOAuthContext("google")?.state ?? "";
    expect(state).not.toBe("");

    window.dispatchEvent(new MessageEvent("message", {
      origin: "https://evil.example",
      data: { type: "nanthai-oauth-result", provider: "google", state, success: true },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: { type: "nanthai-oauth-result", provider: "microsoft", state, success: true },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: { type: "nanthai-oauth-result", provider: "google", state: "stale_state", success: true },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: { type: "nanthai-oauth-result", provider: "google", success: true },
    }));

    const rejection = expect(connection).rejects.toThrow("Google sign-in timed out.");
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    await rejection;
    expect(localStorage.getItem("nanthai.oauth.google")).toBeNull();
  });

  it("rejects with the provider error from the popup result", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "google_client");
    stubOAuthCrypto();
    vi.spyOn(window, "open").mockReturnValue(popupStub() as unknown as Window);

    const connection = connectProviderWithPopup("google");
    await vi.waitFor(() => {
      expect(localStorage.getItem("nanthai.oauth.google")).not.toBeNull();
    });
    const state = readOAuthContext("google")?.state ?? "";
    expect(state).not.toBe("");

    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: {
        type: "nanthai-oauth-result",
        provider: "google",
        state,
        success: false,
        error: "Google denied access.",
      },
    }));

    await expect(connection).rejects.toThrow("Google denied access.");
  });

  it("rejects a second popup connection for the same provider while one is active", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "google_client");
    stubOAuthCrypto();
    vi.spyOn(window, "open").mockReturnValue(popupStub() as unknown as Window);

    const connection = connectProviderWithPopup("google");
    await vi.waitFor(() => {
      expect(localStorage.getItem("nanthai.oauth.google")).not.toBeNull();
    });

    await expect(connectProviderWithPopup("google")).rejects.toThrow("Google sign-in is already in progress.");
    expect(window.open).toHaveBeenCalledTimes(1);

    const state = readOAuthContext("google")?.state ?? "";
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: { type: "nanthai-oauth-result", provider: "google", state, success: true },
    }));

    await expect(connection).resolves.toBeUndefined();
  });
});
