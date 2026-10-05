import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { OnboardingPage } from "./OnboardingPage";
const { analyticsMocks, generatePKCE, navigate, setOnboardingCompleted, beginLocalSetup, sharedState } = vi.hoisted(() => ({
  analyticsMocks: {
    analyticsErrorLabel: vi.fn((error: unknown) => error instanceof Error ? error.name.toLowerCase() : "unknown_error"),
    captureAnalytics: vi.fn(),
  },
  generatePKCE: vi.fn(async () => ({
    state: "state_1",
    verifier: "verifier_1",
    challenge: "challenge_1",
  })),
  navigate: vi.fn(),
  setOnboardingCompleted: vi.fn(async () => null),
  beginLocalSetup: vi.fn(async () => null),
  sharedState: {
    proStatus: { isPro: true },
    hasApiKey: false as boolean | undefined,
    prefs: { onboardingCompleted: false } as undefined | { onboardingCompleted?: boolean; runtimeOnboardingState?: "setup" | "ready" },
  },
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
vi.mock("@convex/_generated/api", () => ({ api: { preferences: { mutations: { setOnboardingCompleted: "complete" } }, runtime_host: { activation: { begin: "begin" } } } }));
vi.mock("convex/react", () => ({
  useMutation: (reference: string) => reference === "begin" ? beginLocalSetup : setOnboardingCompleted,
}));
vi.mock("@/hooks/useSharedData", () => ({
  useOpenRouterStatus: () => sharedState.hasApiKey,
  useSharedData: () => ({ prefs: sharedState.prefs, proStatus: sharedState.proStatus }),
}));

vi.mock("@/components/shared/PaywallModal", () => ({ PaywallModal: ({ onClose }: { onClose: () => void }) => <div role="dialog"><button onClick={onClose}>Close paywall</button></div> }));

vi.mock("@/lib/analytics", () => analyticsMocks);

vi.mock("@/lib/pkce", () => ({
  generatePKCE,
}));

vi.mock("@/components/shared/LoadingSpinner", () => ({
  LoadingSpinner: () => <div>loading</div>,
}));

function renderOnboarding(path = "/onboarding") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <OnboardingPage />
    </MemoryRouter>,
  );
}

function jumpToLastScreen() {
  fireEvent.click(screen.getByRole("button", { name: "Go to screen 6" }));
}

describe("OnboardingPage", () => {
  beforeEach(() => {
    sharedState.hasApiKey = false;
    sharedState.proStatus = { isPro: true };
    sharedState.prefs = { onboardingCompleted: false };
    generatePKCE.mockResolvedValue({
      state: "state_1",
      verifier: "verifier_1",
      challenge: "challenge_1",
    });
    setOnboardingCompleted.mockResolvedValue(null);
    beginLocalSetup.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("redirects completed users out of first-run onboarding but allows replay mode", async () => {
    sharedState.prefs = { onboardingCompleted: true };

    const firstRun = renderOnboarding();
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/app/chat", { replace: true });
    });
    expect(analyticsMocks.captureAnalytics).not.toHaveBeenCalledWith(
      "onboarding_started",
      expect.any(Object),
    );
    expect(analyticsMocks.captureAnalytics).not.toHaveBeenCalledWith(
      "onboarding_step_viewed",
      expect.any(Object),
    );
    firstRun.unmount();
    navigate.mockClear();

    sharedState.prefs = { onboardingCompleted: false, runtimeOnboardingState: "setup" };
    const resumed = renderOnboarding();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/app/settings/local-runtime", { replace: true }));
    resumed.unmount();
    navigate.mockClear();
    renderOnboarding("/onboarding?mode=replay");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps connection choice available during saved local setup without restarting the carousel", () => {
    sharedState.prefs = { onboardingCompleted: false, runtimeOnboardingState: "setup" };
    renderOnboarding("/onboarding?mode=connections");
    expect(screen.getByRole("heading", { name: "runtime_choose_connection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "connect_openrouter" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "runtime_setup_from_onboarding" })).toBeEnabled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("waits for onboarding preferences before capturing first-run analytics", async () => {
    sharedState.prefs = undefined;

    const view = renderOnboarding();

    await waitFor(() => {
      expect(analyticsMocks.captureAnalytics).not.toHaveBeenCalledWith(
        "onboarding_started",
        expect.any(Object),
      );
    });

    sharedState.prefs = { onboardingCompleted: false };
    view.rerender(
      <MemoryRouter initialEntries={["/onboarding"]}>
        <OnboardingPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(analyticsMocks.captureAnalytics).toHaveBeenCalledWith(
        "onboarding_started",
        expect.objectContaining({ replay_mode: false }),
      );
      expect(analyticsMocks.captureAnalytics).toHaveBeenCalledWith(
        "onboarding_step_viewed",
        expect.objectContaining({ step_index: 0 }),
      );
    });
  });

  it("keeps cloud completion gated while offering explicit local setup", () => {
    renderOnboarding();
    jumpToLastScreen();

    expect(screen.getByRole("button", { name: "finish" })).toBeDisabled();
    expect(screen.getByText("continue_with_a_supported_provider_to_finish_onboarding")).toBeInTheDocument();
  });

  it("enters local setup without an OpenRouter key and surfaces save failures", async () => {
    renderOnboarding();
    jumpToLastScreen();
    beginLocalSetup.mockRejectedValueOnce(new Error("Save unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "runtime_setup_from_onboarding" }));
    expect(await screen.findByText("Save unavailable")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "runtime_setup_from_onboarding" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/app/settings/local-runtime", { replace: true }));
    expect(setOnboardingCompleted).not.toHaveBeenCalled();
  });

  it("offers the paywall before saving free local setup and keeps OpenRouter available after cancellation", () => {
    sharedState.proStatus = { isPro: false };
    renderOnboarding("/onboarding?mode=connections");
    fireEvent.click(screen.getByRole("button", { name: "runtime_setup_from_onboarding" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(beginLocalSetup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close paywall" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "connect_openrouter" })).toBeEnabled();
    expect(beginLocalSetup).not.toHaveBeenCalled();
  });

  it("waits for the Convex entitlement after checkout then resumes local setup once", async () => {
    sharedState.proStatus = { isPro: false };
    const view = renderOnboarding("/onboarding?mode=connections&pro=success");
    expect(screen.getByRole("status")).toHaveTextContent("runtime_pro_confirming");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(beginLocalSetup).not.toHaveBeenCalled();
    sharedState.proStatus = { isPro: true };
    view.rerender(<MemoryRouter initialEntries={["/onboarding?mode=connections&pro=success"]}><OnboardingPage /></MemoryRouter>);
    await waitFor(() => expect(beginLocalSetup).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith("/app/settings/local-runtime", { replace: true });
  });

  it("keeps old free local-intent users on the connection choice instead of completing onboarding", () => {
    sharedState.proStatus = { isPro: false };
    sharedState.prefs = { onboardingCompleted: false, runtimeOnboardingState: "setup" };
    renderOnboarding("/onboarding?mode=connections");
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "runtime_setup_from_onboarding" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(beginLocalSetup).not.toHaveBeenCalled();
  });

  it("marks onboarding complete and enters chat when OpenRouter is connected", async () => {
    sharedState.hasApiKey = true;

    renderOnboarding();
    jumpToLastScreen();
    fireEvent.click(screen.getByRole("button", { name: "finish" }));

    await waitFor(() => {
      expect(setOnboardingCompleted).toHaveBeenCalledWith({});
    });
    expect(navigate).toHaveBeenCalledWith("/app/chat", { replace: true });
  });

  it("returns replay completion to settings instead of chat", async () => {
    sharedState.hasApiKey = true;

    renderOnboarding("/onboarding?mode=replay");
    jumpToLastScreen();
    fireEvent.click(screen.getByRole("button", { name: "done" }));

    await waitFor(() => {
      expect(setOnboardingCompleted).toHaveBeenCalledWith({});
    });
    expect(navigate).toHaveBeenCalledWith("/app/settings", { replace: true });
  });

  it("surfaces PKCE setup failures before leaving for OpenRouter", async () => {
    generatePKCE.mockRejectedValueOnce(new Error("PKCE unavailable"));

    renderOnboarding();
    jumpToLastScreen();
    fireEvent.click(screen.getByRole("button", { name: "connect_openrouter" }));

    expect(await screen.findByText("PKCE unavailable")).toBeInTheDocument();
    expect(sessionStorage.getItem("pkce_state")).toBeNull();
    expect(sessionStorage.getItem("openrouter_post_connect")).toBeNull();
  });

  it("writes PKCE session state and redirects to OpenRouter from first-run onboarding", async () => {
    const location = {
      ...originalLocation,
      href: "http://localhost/onboarding",
      origin: "http://localhost",
    };
    Object.defineProperty(window, "location", {
      configurable: true,
      value: location,
    });

    renderOnboarding();
    jumpToLastScreen();
    fireEvent.click(screen.getByRole("button", { name: "connect_openrouter" }));

    await waitFor(() => {
      expect(sessionStorage.getItem("pkce_state")).toBe("state_1");
    });
    expect(sessionStorage.getItem("pkce_verifier")).toBe("verifier_1");
    expect(sessionStorage.getItem("openrouter_post_connect")).toBe("onboarding");
    expect(sessionStorage.getItem("openrouter_post_connect_source")).toBe("onboarding");
    expect(sessionStorage.getItem("openrouter_post_connect_path")).toBeNull();
    expect(window.location.href).toContain("https://openrouter.ai/auth?");
    expect(window.location.href).toContain("code_challenge=challenge_1");
    expect(window.location.href).toContain("state=state_1");
  });

  it("stores the replay return target before redirecting to OpenRouter", async () => {
    const location = {
      ...originalLocation,
      href: "http://localhost/onboarding?mode=replay",
      origin: "http://localhost",
    };
    Object.defineProperty(window, "location", {
      configurable: true,
      value: location,
    });

    renderOnboarding("/onboarding?mode=replay");
    jumpToLastScreen();
    fireEvent.click(screen.getByRole("button", { name: "connect_openrouter" }));

    await waitFor(() => {
      expect(sessionStorage.getItem("openrouter_post_connect")).toBe("return");
    });
    expect(sessionStorage.getItem("openrouter_post_connect_path")).toBe("/app/settings");
    expect(sessionStorage.getItem("openrouter_post_connect_source")).toBe("onboarding_replay");
    expect(window.location.href).toContain("https://openrouter.ai/auth?");
  });
});
