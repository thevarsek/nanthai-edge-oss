import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SettingsPage } from "./SettingsPage";

const { navigate, upsertPreferences, userState } = vi.hoisted(() => ({
  navigate: vi.fn(),
  upsertPreferences: vi.fn(async () => null),
  userState: {
    setProfileImage: vi.fn(async () => null),
    externalAccounts: [] as Array<{ id: string; provider?: string; emailAddress?: string }>,
    hasImage: false,
    imageUrl: "",
  },
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

vi.mock("@clerk/react", () => ({
  useClerk: () => ({
    signOut: vi.fn(async () => null),
  }),
  useUser: () => ({
    user: {
      firstName: "Ada",
      lastName: "Lovelace",
      imageUrl: userState.imageUrl,
      hasImage: userState.hasImage,
      primaryEmailAddressId: "email_1",
      primaryEmailAddress: { emailAddress: "ada@example.com" },
      emailAddresses: [{ id: "email_1", emailAddress: "ada@example.com" }],
      externalAccounts: userState.externalAccounts,
      setProfileImage: userState.setProfileImage,
    },
  }),
}));

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(async () => null),
  useMutation: () => upsertPreferences,
}));

vi.mock("@/components/settings/AccountSection", () => ({
  AccountSection: ({ onShowProfile }: { onShowProfile: () => void }) => (
    <button type="button" onClick={onShowProfile}>open profile</button>
  ),
}));

vi.mock("@/components/settings/OpenRouterSection", () => ({
  OpenRouterSection: () => <div>openrouter section</div>,
}));

vi.mock("@/components/settings/IntegrationsSection", () => ({
  IntegrationsSection: ({ onNavigate }: { onNavigate: (page: "integrations") => void }) => (
    <button type="button" onClick={() => onNavigate("integrations")}>open integrations</button>
  ),
  IntegrationsSubPage: () => <div>integrations subpage</div>,
}));

vi.mock("@/components/settings/ProvidersSection", () => ({
  ProvidersSection: () => <div>providers section</div>,
}));

vi.mock("@/components/settings/ChatDefaultsSection", () => ({
  ChatDefaultsSection: () => <div>chat defaults subpage</div>,
}));

vi.mock("@/components/settings/AppearanceSection", () => ({
  AppearanceSection: () => <div>appearance section</div>,
}));

vi.mock("@/components/settings/NotificationsSection", () => ({
  NotificationsSection: () => <div>notifications section</div>,
}));

vi.mock("@/hooks/useProGate", () => ({
  ProGateWrapper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function renderSettingsPage() {
  return render(
    <MemoryRouter initialEntries={["/app/settings"]}>
      <SettingsPage />
    </MemoryRouter>,
  );
}

describe("SettingsPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
    userState.setProfileImage.mockResolvedValue(null);
    userState.externalAccounts = [];
    userState.hasImage = false;
    userState.imageUrl = "";
  });

  it("falls back to the app root when closing settings without browser history", () => {
    Object.defineProperty(window.history, "state", {
      configurable: true,
      value: { idx: 0 },
    });

    renderSettingsPage();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));

    expect(navigate).toHaveBeenCalledWith("/app");
  });

  it("uses browser back when settings has route history", () => {
    Object.defineProperty(window.history, "state", {
      configurable: true,
      value: { idx: 2 },
    });

    renderSettingsPage();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));

    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it("opens and returns from the integrations subpage without losing settings shell state", () => {
    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: "open integrations" }));
    expect(screen.getByText("integrations subpage")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(screen.getByText("openrouter section")).toBeInTheDocument();
  });

  it("replays setup and in-app walkthrough routes from support actions", () => {
    renderSettingsPage();

    fireEvent.click(screen.getByText("replay_setup_tour"));
    expect(navigate).toHaveBeenCalledWith("/onboarding?mode=replay");

    fireEvent.click(screen.getByText("replay_in_app_walkthrough"));
    expect(upsertPreferences).toHaveBeenCalledWith({ hasSeenMainWalkthrough: false });
    expect(navigate).toHaveBeenCalledWith("/app");
  });

  it("renders profile details, deduplicates linked accounts, and surfaces photo errors", async () => {
    userState.hasImage = true;
    userState.imageUrl = "https://example.com/profile.png";
    userState.externalAccounts = [
      { id: "google_1", provider: "oauth_google", emailAddress: "ada@gmail.com" },
      { id: "google_2", provider: "oauth_google", emailAddress: "duplicate@gmail.com" },
      { id: "github_1", provider: "oauth_github", emailAddress: "ada@github.example" },
    ];
    userState.setProfileImage.mockRejectedValueOnce(new Error("upload blocked"));

    renderSettingsPage();
    fireEvent.click(screen.getByRole("button", { name: "open profile" }));

    expect(screen.getByRole("img", { name: "Ada Lovelace" })).toHaveAttribute("src", "https://example.com/profile.png");
    expect(screen.getAllByText("ada@example.com")).toHaveLength(2);
    expect(screen.getByText("primary_email_badge")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.getByText("Github")).toBeInTheDocument();
    expect(screen.queryByText("duplicate@gmail.com")).not.toBeInTheDocument();

    const file = new File(["avatar"], "avatar.png", { type: "image/png" });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });

    await waitFor(() => expect(userState.setProfileImage).toHaveBeenCalledWith({ file }));
    expect(await screen.findByText("upload_failed_arg")).toBeInTheDocument();
  });

  it("removes a profile photo and reports remove failures", async () => {
    userState.hasImage = true;
    userState.imageUrl = "https://example.com/profile.png";
    userState.setProfileImage.mockRejectedValueOnce(new Error("remove blocked"));

    renderSettingsPage();
    fireEvent.click(screen.getByRole("button", { name: "open profile" }));
    fireEvent.click(screen.getByRole("button", { name: "remove_photo" }));

    await waitFor(() => expect(userState.setProfileImage).toHaveBeenCalledWith({ file: null }));
    expect(await screen.findByText("remove_failed_arg")).toBeInTheDocument();
  });
});
