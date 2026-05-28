import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { OpenRouterRequiredPage } from "./OpenRouterRequiredPage";

const { navigate, sharedState, signOut, generatePKCE } = vi.hoisted(() => ({
  navigate: vi.fn(),
  sharedState: {
    hasApiKey: false as boolean | undefined,
    prefs: { onboardingCompleted: true } as undefined | { onboardingCompleted?: boolean },
  },
  signOut: vi.fn((callback: () => void) => callback()),
  generatePKCE: vi.fn(async () => ({
    state: "state_1",
    verifier: "verifier_1",
    challenge: "challenge_1",
  })),
}));

const originalLocation = window.location;

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut }),
}));

vi.mock("@/hooks/useSharedData", () => ({
  useOpenRouterStatus: () => sharedState.hasApiKey,
  useSharedData: () => ({ prefs: sharedState.prefs }),
}));

vi.mock("@/lib/pkce", () => ({
  generatePKCE,
}));

vi.mock("@/components/shared/LoadingSpinner", () => ({
  LoadingSpinner: () => <div>loading</div>,
}));

function renderRequiredPage(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/openrouter-required", state }]}>
      <OpenRouterRequiredPage />
    </MemoryRouter>,
  );
}

describe("OpenRouterRequiredPage", () => {
  beforeEach(() => {
    sharedState.hasApiKey = false;
    sharedState.prefs = { onboardingCompleted: true };
    generatePKCE.mockResolvedValue({
      state: "state_1",
      verifier: "verifier_1",
      challenge: "challenge_1",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("redirects incomplete onboarding before offering reconnect", async () => {
    sharedState.prefs = { onboardingCompleted: false };

    renderRequiredPage();

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/onboarding", { replace: true });
    });
  });

  it("returns connected users to the protected app route that requested OpenRouter", async () => {
    sharedState.hasApiKey = true;

    renderRequiredPage({
      from: { pathname: "/app/settings/jobs", search: "?job=1", hash: "#run" },
    });

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/app/settings/jobs?job=1#run", { replace: true });
    });
  });

  it("falls back to chat when the stored return path is outside the app shell", async () => {
    sharedState.hasApiKey = true;

    renderRequiredPage({
      from: { pathname: "/admin", search: "?next=/app/chat", hash: "" },
    });

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/app/chat", { replace: true });
    });
  });

  it("shows connect errors without writing stale PKCE session state", async () => {
    generatePKCE.mockRejectedValueOnce(new Error("crypto unavailable"));

    renderRequiredPage();
    fireEvent.click(screen.getByRole("button", { name: "connect_openrouter" }));

    expect(await screen.findByText("crypto unavailable")).toBeInTheDocument();
    expect(sessionStorage.getItem("pkce_state")).toBeNull();
    expect(sessionStorage.getItem("openrouter_post_connect")).toBeNull();
  });

  it("writes return-target PKCE state and redirects to OpenRouter", async () => {
    const location = {
      ...originalLocation,
      href: "http://localhost/openrouter-required",
      origin: "http://localhost",
    };
    Object.defineProperty(window, "location", {
      configurable: true,
      value: location,
    });

    renderRequiredPage({
      from: { pathname: "/app/settings/jobs", search: "?job=1", hash: "#run" },
    });
    fireEvent.click(screen.getByRole("button", { name: "connect_openrouter" }));

    await waitFor(() => {
      expect(sessionStorage.getItem("pkce_state")).toBe("state_1");
    });
    expect(sessionStorage.getItem("pkce_verifier")).toBe("verifier_1");
    expect(sessionStorage.getItem("openrouter_post_connect")).toBe("return");
    expect(sessionStorage.getItem("openrouter_post_connect_path")).toBe("/app/settings/jobs?job=1#run");
    expect(window.location.href).toContain("https://openrouter.ai/auth?");
    expect(window.location.href).toContain("code_challenge=challenge_1");
    expect(window.location.href).toContain("state=state_1");
  });

  it("signs out through Clerk and returns to the public introduction", () => {
    renderRequiredPage();

    fireEvent.click(screen.getByRole("button", { name: "sign_out" }));

    expect(signOut).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
  });
});
