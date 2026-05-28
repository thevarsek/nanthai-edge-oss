import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { OpenRouterConnectPage } from "./OpenRouterConnectPage";

const {
  authState,
  exchangeCodeForKey,
  navigate,
  setOnboardingCompleted,
  upsertApiKey,
} = vi.hoisted(() => ({
  authState: {
    isAuthenticated: true,
    isLoading: false,
  },
  exchangeCodeForKey: vi.fn(async () => "sk-or-key"),
  navigate: vi.fn(),
  setOnboardingCompleted: vi.fn(async () => null),
  upsertApiKey: vi.fn(async () => null),
}));

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

vi.mock("@/lib/pkce", () => ({
  exchangeCodeForKey,
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    preferences: { mutations: { setOnboardingCompleted: "setOnboardingCompleted" } },
    scheduledJobs: { mutations: { upsertApiKey: "upsertApiKey" } },
  },
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => authState,
  useMutation: (mutation: string) => {
    if (mutation === "setOnboardingCompleted") return setOnboardingCompleted;
    return upsertApiKey;
  },
}));

vi.mock("@/components/shared/LoadingSpinner", () => ({
  LoadingSpinner: () => <div>loading</div>,
}));

function renderConnectPage(path = "/openrouter/callback?code=code_1&state=state_1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <OpenRouterConnectPage />
    </MemoryRouter>,
  );
}

async function flushCallbackWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("OpenRouterConnectPage", () => {
  beforeEach(() => {
    authState.isAuthenticated = true;
    authState.isLoading = false;
    exchangeCodeForKey.mockResolvedValue("sk-or-key");
    setOnboardingCompleted.mockResolvedValue(null);
    upsertApiKey.mockResolvedValue(null);
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it("exchanges a valid onboarding callback, clears PKCE state, stores the key, and navigates into chat", async () => {
    vi.useFakeTimers();
    sessionStorage.setItem("pkce_state", "state_1");
    sessionStorage.setItem("pkce_verifier", "verifier_1");
    sessionStorage.setItem("openrouter_post_connect", "onboarding");

    renderConnectPage();

    await flushCallbackWork();
    expect(exchangeCodeForKey).toHaveBeenCalledWith("code_1", "verifier_1");
    expect(upsertApiKey).toHaveBeenCalledWith({ apiKey: "sk-or-key" });
    expect(setOnboardingCompleted).toHaveBeenCalledWith({});
    expect(sessionStorage.getItem("pkce_state")).toBeNull();
    expect(sessionStorage.getItem("pkce_verifier")).toBeNull();
    expect(sessionStorage.getItem("openrouter_post_connect")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(navigate).toHaveBeenCalledWith("/app/chat", { replace: true });
  });

  it("uses only safe app return paths after reconnecting from the required-key gate", async () => {
    vi.useFakeTimers();
    sessionStorage.setItem("pkce_state", "state_1");
    sessionStorage.setItem("pkce_verifier", "verifier_1");
    sessionStorage.setItem("openrouter_post_connect", "return");
    sessionStorage.setItem("openrouter_post_connect_path", "https://evil.example/app/chat");

    renderConnectPage();

    await flushCallbackWork();
    expect(upsertApiKey).toHaveBeenCalledWith({ apiKey: "sk-or-key" });
    expect(setOnboardingCompleted).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(navigate).toHaveBeenCalledWith("/app/chat", { replace: true });
  });

  it("rejects missing or mismatched PKCE state before exchanging the code", async () => {
    sessionStorage.setItem("pkce_state", "expected");
    sessionStorage.setItem("pkce_verifier", "verifier_1");
    sessionStorage.setItem("openrouter_post_connect", "settings");

    renderConnectPage("/openrouter/callback?code=code_1&state=wrong");

    expect(await screen.findByText("openrouter_err_state_mismatch")).toBeInTheDocument();
    expect(exchangeCodeForKey).not.toHaveBeenCalled();
    expect(upsertApiKey).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "openrouter_back_to_settings" }));
    expect(navigate).toHaveBeenCalledWith("/app/settings", { replace: true });
  });

  it("waits for Convex auth before exchanging and shows a delayed-auth message", async () => {
    vi.useFakeTimers();
    authState.isAuthenticated = false;
    authState.isLoading = false;
    sessionStorage.setItem("pkce_state", "state_1");
    sessionStorage.setItem("pkce_verifier", "verifier_1");

    renderConnectPage();

    expect(exchangeCodeForKey).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });

    expect(screen.getByText("Authentication is taking longer than expected. We’ll keep trying automatically."))
      .toBeInTheDocument();
    expect(exchangeCodeForKey).not.toHaveBeenCalled();
  });
});
