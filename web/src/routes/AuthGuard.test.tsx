import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthGuard } from "./AuthGuard";

const { authState, convexAuthState, sharedState, ensurePrefs } = vi.hoisted(() => ({
  authState: {
    isLoaded: true,
    isSignedIn: true,
  },
  convexAuthState: {
    isLoading: false,
    isAuthenticated: true,
  },
  sharedState: {
    prefs: { onboardingCompleted: true } as null | undefined | { onboardingCompleted: boolean },
    proStatus: { isPro: false } as undefined | { isPro: boolean },
  },
  ensurePrefs: vi.fn(async () => null),
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => authState,
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => convexAuthState,
  useMutation: () => ensurePrefs,
}));

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => sharedState,
}));

vi.mock("@/components/shared/LoadingSpinner", () => ({
  LoadingSpinner: () => <div>loading</div>,
}));

function renderGuard(children: React.ReactNode = <div>protected app</div>, requireOnboarding = true) {
  return render(
    <MemoryRouter initialEntries={["/app/chat?draft=1#latest"]}>
      <Routes>
        <Route
          path="/app/chat"
          element={<AuthGuard requireOnboarding={requireOnboarding}>{children}</AuthGuard>}
        />
        <Route path="/sign-in" element={<div>sign in page</div>} />
        <Route path="/onboarding" element={<div>onboarding page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AuthGuard", () => {
  beforeEach(() => {
    authState.isLoaded = true;
    authState.isSignedIn = true;
    convexAuthState.isLoading = false;
    convexAuthState.isAuthenticated = true;
    sharedState.prefs = { onboardingCompleted: true };
    sharedState.proStatus = { isPro: false };
    ensurePrefs.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("redirects signed-out users to sign in before rendering protected app content", () => {
    authState.isSignedIn = false;

    renderGuard();

    expect(screen.getByText("sign in page")).toBeInTheDocument();
    expect(screen.queryByText("protected app")).not.toBeInTheDocument();
  });

  it("bootstraps a missing preferences row and lets the user retry failures", async () => {
    sharedState.prefs = null;
    ensurePrefs.mockRejectedValueOnce(new Error("could not create preferences"));

    renderGuard();

    expect(await screen.findByText("could not create preferences")).toBeInTheDocument();
    expect(ensurePrefs).toHaveBeenCalledTimes(1);

    ensurePrefs.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(ensurePrefs).toHaveBeenCalledTimes(2);
    });
  });

  it("requires onboarding only when the guarded route opts into that gate", () => {
    sharedState.prefs = { onboardingCompleted: false };

    const gated = renderGuard();
    expect(screen.getByText("onboarding page")).toBeInTheDocument();
    gated.unmount();

    renderGuard(<div>onboarding shell</div>, false);
    expect(screen.getByText("onboarding shell")).toBeInTheDocument();
  });

  it("waits for pro status before rendering the protected app", () => {
    sharedState.proStatus = undefined;

    renderGuard();

    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(screen.queryByText("protected app")).not.toBeInTheDocument();
  });
});
