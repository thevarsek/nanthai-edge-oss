import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ProviderOAuthCallbackPage } from "./ProviderOAuthCallbackPage";
import {
  isMobileOAuthRelayRequest,
  nativeOAuthCallbackUrl,
} from "./ProviderOAuthCallbackPage.helpers";

const {
  authState,
  clearOAuthContext,
  exchangeGoogleCode,
  exchangeMicrosoftCode,
  exchangeNotionCode,
  exchangeSlackCode,
  postOAuthResult,
  readOAuthContext,
  redirectToNativeOAuthCallback,
} = vi.hoisted(() => ({
  authState: {
    isAuthenticated: true,
    isLoading: false,
  },
  clearOAuthContext: vi.fn(),
  exchangeGoogleCode: vi.fn(async () => null),
  exchangeMicrosoftCode: vi.fn(async () => null),
  exchangeNotionCode: vi.fn(async () => null),
  exchangeSlackCode: vi.fn(async () => null),
  postOAuthResult: vi.fn(),
  readOAuthContext: vi.fn(),
  redirectToNativeOAuthCallback: vi.fn(),
}));

let actionIndex = 0;
const originalUserAgent = window.navigator.userAgent;

vi.mock("convex/react", () => ({
  useAction: () => {
    const actions = [exchangeGoogleCode, exchangeMicrosoftCode, exchangeNotionCode, exchangeSlackCode];
    return actions[actionIndex++ % actions.length];
  },
  useConvexAuth: () => authState,
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

vi.mock("./ProviderOAuthCallbackPage.helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ProviderOAuthCallbackPage.helpers")>();
  return {
    ...actual,
    redirectToNativeOAuthCallback,
  };
});

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
    authState.isAuthenticated = true;
    authState.isLoading = false;
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
    vi.useRealTimers();
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: null,
    });
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: originalUserAgent,
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
      state: "expected",
      success: true,
    });
  });

  it("exchanges a Slack callback with the stored PKCE verifier", async () => {
    readOAuthContext.mockReturnValue({
      state: "expected",
      verifier: "slack_verifier",
      redirectUri: "https://app.example/oauth/slack/callback",
      createdAt: Date.now(),
    });

    renderCallback("/oauth/slack/callback?code=slack_code&state=expected", "slack");

    await waitFor(() => {
      expect(exchangeSlackCode).toHaveBeenCalledWith({
        code: "slack_code",
        codeVerifier: "slack_verifier",
        redirectUri: "https://app.example/oauth/slack/callback",
      });
    });
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
    expect(postOAuthResult).toHaveBeenCalledWith({
      type: "nanthai-oauth-result",
      provider: "slack",
      state: "expected",
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
      state: "expected",
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
      state: "expected",
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
    expect(redirectToNativeOAuthCallback).not.toHaveBeenCalled();
  });

  it("relays mobile callbacks to the native URL when there is no web popup context", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Linux; Android 15; Pixel 7)",
    });
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: null,
    });
    readOAuthContext.mockReturnValue(null);

    renderCallback("/oauth/google/callback?code=code_1&state=expected");

    await waitFor(() => {
      expect(redirectToNativeOAuthCallback).toHaveBeenCalledWith(
        "tech.nanthai.NanthAi-Edge://oauth/google/callback?code=code_1&state=expected",
      );
    });
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
    expect(postOAuthResult).not.toHaveBeenCalled();
  });

  it("relays iPadOS desktop-style callbacks to the native URL without web popup context", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    });
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: null,
    });
    readOAuthContext.mockReturnValue(null);

    renderCallback("/oauth/microsoft/callback?code=ms_code&state=native_state", "microsoft");

    await waitFor(() => {
      expect(redirectToNativeOAuthCallback).toHaveBeenCalledWith(
        "tech.nanthai.NanthAi-Edge://oauth/microsoft/callback?code=ms_code&state=native_state",
      );
    });
    expect(exchangeMicrosoftCode).not.toHaveBeenCalled();
    expect(postOAuthResult).not.toHaveBeenCalled();
  });

  it("does not treat desktop Safari as a mobile OAuth relay request", () => {
    expect(isMobileOAuthRelayRequest(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    )).toBe(false);
  });

  it("relays mobile Slack callbacks when only a stale web popup context exists", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Linux; Android 15; Pixel 7)",
    });
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: null,
    });
    readOAuthContext.mockReturnValue({
      state: "stale",
      redirectUri: "https://app.example/oauth/slack/callback",
      createdAt: Date.now(),
    });

    renderCallback("/oauth/slack/callback?code=slack_code&state=native_state", "slack");

    await waitFor(() => {
      expect(redirectToNativeOAuthCallback).toHaveBeenCalledWith(
        "tech.nanthai.NanthAi-Edge://oauth/slack/callback?code=slack_code&state=native_state",
      );
    });
    expect(exchangeSlackCode).not.toHaveBeenCalled();
    expect(postOAuthResult).not.toHaveBeenCalled();
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
      state: "expected",
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
      state: "expected",
      success: false,
      error: "Google sign-in has expired. Start the connection again.",
    });
  });

  it("surfaces provider error callbacks before exchanging a code", async () => {
    renderCallback("/oauth/google/callback?error=access_denied&error_description=User+cancelled&state=expected");

    expect(await screen.findByText("Google sign-in failed: User cancelled")).toBeInTheDocument();
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
    expect(clearOAuthContext).toHaveBeenCalledWith("google");
    expect(postOAuthResult).toHaveBeenCalledWith({
      type: "nanthai-oauth-result",
      provider: "google",
      state: "expected",
      success: false,
      error: "Google sign-in failed: User cancelled",
    });
  });

  it("reports provider errors before waiting for Convex auth", async () => {
    authState.isAuthenticated = false;
    authState.isLoading = false;

    renderCallback(
      "/oauth/notion/callback?error=access_denied&error_description=User+cancelled&state=expected",
      "notion",
    );

    expect(await screen.findByText("Notion sign-in failed: User cancelled")).toBeInTheDocument();
    expect(exchangeNotionCode).not.toHaveBeenCalled();
    expect(postOAuthResult).toHaveBeenCalledWith({
      type: "nanthai-oauth-result",
      provider: "notion",
      state: "expected",
      success: false,
      error: "Notion sign-in failed: User cancelled",
    });
  });

  it("waits for Convex auth and surfaces the delayed-auth message before exchanging", async () => {
    vi.useFakeTimers();
    authState.isAuthenticated = false;
    authState.isLoading = false;
    renderCallback("/oauth/google/callback?code=code_1&state=expected");

    expect(exchangeGoogleCode).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });

    expect(screen.getByText(
      "Authentication is taking longer than expected. This window will keep trying automatically.",
    )).toBeInTheDocument();
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
  });

  it("exchanges once when Convex auth becomes ready after an auth wait", async () => {
    authState.isAuthenticated = false;
    authState.isLoading = false;
    const view = renderCallback("/oauth/google/callback?code=code_1&state=expected");

    expect(exchangeGoogleCode).not.toHaveBeenCalled();

    authState.isAuthenticated = true;
    view.rerender(
      <MemoryRouter initialEntries={["/oauth/google/callback?code=code_1&state=expected"]}>
        <ProviderOAuthCallbackPage provider="google" />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(exchangeGoogleCode).toHaveBeenCalledTimes(1);
    });

    view.rerender(
      <MemoryRouter initialEntries={["/oauth/google/callback?code=code_1&state=expected"]}>
        <ProviderOAuthCallbackPage provider="google" />
      </MemoryRouter>,
    );
    expect(exchangeGoogleCode).toHaveBeenCalledTimes(1);
  });

  it("clears the self-close timer when the callback component unmounts", async () => {
    vi.useFakeTimers();
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});
    const view = renderCallback("/oauth/google/callback?code=code_1&state=expected");

    await act(async () => {
      await Promise.resolve();
    });
    expect(postOAuthResult).toHaveBeenCalledWith({
      type: "nanthai-oauth-result",
      provider: "google",
      state: "expected",
      success: true,
    });

    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("rejects provider error callbacks with mismatched state", async () => {
    renderCallback(
      "/oauth/microsoft/callback?error=access_denied&error_description=forced&state=wrong",
      "microsoft",
    );

    expect(await screen.findByText("Microsoft sign-in state mismatch. Please try again.")).toBeInTheDocument();
    expect(exchangeMicrosoftCode).not.toHaveBeenCalled();
    expect(postOAuthResult).toHaveBeenCalledWith({
      type: "nanthai-oauth-result",
      provider: "microsoft",
      state: "expected",
      success: false,
      error: "Microsoft sign-in state mismatch. Please try again.",
    });
  });

  it("does not schedule a self-close timer on callback errors", async () => {
    vi.useFakeTimers();
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});

    renderCallback("/oauth/google/callback?code=code_1&state=wrong");

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Google sign-in state mismatch. Please try again.")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(closeSpy).not.toHaveBeenCalled();
  });
});
