import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ProviderOAuthCallbackPage } from "./ProviderOAuthCallbackPage";
import { nativeOAuthCallbackUrl } from "./ProviderOAuthCallbackPage.helpers";

const {
  clearOAuthContext,
  exchangeGoogleCode,
  exchangeMicrosoftCode,
  exchangeNotionCode,
  exchangeSlackCode,
  postOAuthResult,
  readOAuthContext,
} = vi.hoisted(() => ({
  clearOAuthContext: vi.fn(),
  exchangeGoogleCode: vi.fn(async () => null),
  exchangeMicrosoftCode: vi.fn(async () => null),
  exchangeNotionCode: vi.fn(async () => null),
  exchangeSlackCode: vi.fn(async () => null),
  postOAuthResult: vi.fn(),
  readOAuthContext: vi.fn(),
}));

let actionIndex = 0;

vi.mock("convex/react", () => ({
  useAction: () => {
    const actions = [exchangeGoogleCode, exchangeMicrosoftCode, exchangeNotionCode, exchangeSlackCode];
    return actions[actionIndex++ % actions.length];
  },
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

vi.mock("@/lib/providerOAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providerOAuth")>();
  return {
    ...actual,
    clearOAuthContext,
    postOAuthResult,
    readOAuthContext,
  };
});

vi.mock("@/components/shared/LoadingSpinner", () => ({
  LoadingSpinner: () => <div>loading</div>,
}));

function renderCallback(path: string, provider: "google" | "microsoft" | "notion" | "slack" = "google") {
  actionIndex = 0;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ProviderOAuthCallbackPage provider={provider} />
    </MemoryRouter>,
  );
}

describe("ProviderOAuthCallbackPage", () => {
  beforeEach(() => {
    vi.spyOn(window, "close").mockImplementation(() => {});
    readOAuthContext.mockReturnValue({
      state: "expected",
      verifier: "verifier_1",
      redirectUri: "https://app.example/oauth/google/callback",
      createdAt: Date.now(),
      requestedIntegration: "drive",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: null,
    });
  });

  it("exchanges a Google callback with the stored PKCE verifier and integration", async () => {
    renderCallback("/oauth/google/callback?code=code_1&state=expected");

    await waitFor(() => {
      expect(exchangeGoogleCode).toHaveBeenCalledWith({
        code: "code_1",
        codeVerifier: "verifier_1",
        redirectUri: "https://app.example/oauth/google/callback",
        requestedIntegration: "drive",
      });
    });
    expect(clearOAuthContext).toHaveBeenCalledWith("google");
    expect(postOAuthResult).toHaveBeenCalledWith({
      type: "nanthai-oauth-result",
      provider: "google",
      success: true,
    });
  });

  it("uses the Slack exchange path without requiring a PKCE verifier", async () => {
    readOAuthContext.mockReturnValue({
      state: "expected",
      redirectUri: "https://app.example/oauth/slack/callback",
      createdAt: Date.now(),
    });

    renderCallback("/oauth/slack/callback?code=slack_code&state=expected", "slack");

    await waitFor(() => {
      expect(exchangeSlackCode).toHaveBeenCalledWith({
        code: "slack_code",
        redirectUri: "https://app.example/oauth/slack/callback",
      });
    });
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
    expect(postOAuthResult).toHaveBeenCalledWith({
      type: "nanthai-oauth-result",
      provider: "slack",
      success: true,
    });
  });

  it("exchanges a Microsoft callback with the stored PKCE verifier", async () => {
    readOAuthContext.mockReturnValue({
      state: "expected",
      verifier: "verifier_2",
      redirectUri: "https://app.example/oauth/microsoft/callback",
      createdAt: Date.now(),
    });

    renderCallback("/oauth/microsoft/callback?code=ms_code&state=expected", "microsoft");

    await waitFor(() => {
      expect(exchangeMicrosoftCode).toHaveBeenCalledWith({
        code: "ms_code",
        codeVerifier: "verifier_2",
        redirectUri: "https://app.example/oauth/microsoft/callback",
      });
    });
    expect(clearOAuthContext).toHaveBeenCalledWith("microsoft");
    expect(postOAuthResult).toHaveBeenCalledWith({
      type: "nanthai-oauth-result",
      provider: "microsoft",
      success: true,
    });
  });

  it("exchanges a Notion web callback when local context is present", async () => {
    readOAuthContext.mockReturnValue({
      state: "expected",
      redirectUri: "https://app.example/oauth/notion/callback",
      createdAt: Date.now(),
    });

    renderCallback("/oauth/notion/callback?code=notion_code&state=expected", "notion");

    await waitFor(() => {
      expect(exchangeNotionCode).toHaveBeenCalledWith({
        code: "notion_code",
        redirectUri: "https://app.example/oauth/notion/callback",
      });
    });
    expect(postOAuthResult).toHaveBeenCalledWith({
      type: "nanthai-oauth-result",
      provider: "notion",
      success: true,
    });
  });

  it("keeps mobile web callbacks in the web flow when local context is present", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    });
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: null,
    });

    renderCallback("/oauth/google/callback?code=code_1&state=expected");

    await waitFor(() => {
      expect(exchangeGoogleCode).toHaveBeenCalledWith({
        code: "code_1",
        codeVerifier: "verifier_1",
        redirectUri: "https://app.example/oauth/google/callback",
        requestedIntegration: "drive",
      });
    });
    expect(window.location.href).not.toContain("tech.nanthai.NanthAi-Edge://");
  });

  it("builds the native Notion callback URL with provider query parameters", () => {
    const params = new URLSearchParams({
      code: "notion_code",
      state: "state_1",
    });

    expect(nativeOAuthCallbackUrl("notion", params)).toBe(
      "tech.nanthai.NanthAi-Edge://oauth/notion/callback?code=notion_code&state=state_1",
    );
  });

  it("rejects mismatched OAuth state before exchanging a code", async () => {
    renderCallback("/oauth/google/callback?code=code_1&state=wrong");

    expect(await screen.findByText("Google sign-in state mismatch. Please try again.")).toBeInTheDocument();
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
    expect(clearOAuthContext).toHaveBeenCalledWith("google");
    expect(postOAuthResult).toHaveBeenCalledWith({
      type: "nanthai-oauth-result",
      provider: "google",
      success: false,
      error: "Google sign-in state mismatch. Please try again.",
    });
  });

  it("reports missing web OAuth context without exchanging a code", async () => {
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: { closed: false },
    });
    readOAuthContext.mockReturnValue(null);

    renderCallback("/oauth/google/callback?code=code_1&state=expected");

    expect(await screen.findByText("Google sign-in has expired. Start the connection again.")).toBeInTheDocument();
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
    expect(postOAuthResult).toHaveBeenCalledWith({
      type: "nanthai-oauth-result",
      provider: "google",
      success: false,
      error: "Google sign-in has expired. Start the connection again.",
    });
  });

  it("surfaces provider error callbacks before exchanging a code", async () => {
    renderCallback("/oauth/google/callback?error=access_denied&error_description=User+cancelled");

    expect(await screen.findByText("Google sign-in failed: User cancelled")).toBeInTheDocument();
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
    expect(clearOAuthContext).toHaveBeenCalledWith("google");
    expect(postOAuthResult).toHaveBeenCalledWith({
      type: "nanthai-oauth-result",
      provider: "google",
      success: false,
      error: "Google sign-in failed: User cancelled",
    });
  });
});
