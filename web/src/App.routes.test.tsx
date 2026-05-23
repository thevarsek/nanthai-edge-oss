import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Outlet } from "react-router-dom";
import { App } from "./App";

vi.mock("./routes/AuthGuard", () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./routes/RootLayout", () => ({
  RootLayout: () => <Outlet />,
}));

vi.mock("./components/shared/AppEmptyState", () => ({
  AppEmptyState: () => <div>app-empty-state</div>,
}));

vi.mock("./components/shared/LoadingSpinner", () => ({
  LoadingSpinner: () => <div>loading</div>,
}));

vi.mock("./pages/OpenRouterCallbackPage", () => ({
  OpenRouterCallbackPage: () => <div>native-openrouter-callback</div>,
}));

vi.mock("./pages/TermsPage", () => ({
  TermsPage: () => <div>terms-page</div>,
}));

vi.mock("./routes/SignInPage", () => ({
  SignInPage: () => <div>sign-in-page</div>,
}));

vi.mock("./routes/ProviderOAuthCallbackPage", () => ({
  ProviderOAuthCallbackPage: ({ provider }: { provider: string }) => <div>oauth:{provider}</div>,
}));

vi.mock("./routes/MobileDrivePickerPage", () => ({
  MobileDrivePickerPage: () => <div>mobile-drive-picker</div>,
}));

vi.mock("./pages/features/SearchPage", () => ({
  SearchPage: () => <div>feature-search-page</div>,
}));

vi.mock("./pages/features/ChatDefaultsPage", () => ({
  ChatDefaultsPage: () => <div>feature-chat-defaults-page</div>,
}));

vi.mock("./pages/features/AutomatedTasksPage", () => ({
  AutomatedTasksPage: () => {
    throw new Error("chunk failed");
  },
}));

vi.mock("./pages/features/BranchingPage", () => ({
  BranchingPage: () => <div>feature-branching-page</div>,
}));

vi.mock("./pages/features/AudioGenerationPage", () => ({
  AudioGenerationPage: () => <div>feature-audio-generation-page</div>,
}));

vi.mock("./pages/features/ThemesPage", () => ({
  ThemesPage: () => <div>feature-themes-page</div>,
}));

vi.mock("./routes/ChatPage", () => ({
  ChatPage: () => <div>chat-page</div>,
}));

vi.mock("./routes/PersonaEditorPage", () => ({
  PersonaEditorPage: () => <div>persona-editor-page</div>,
}));

vi.mock("./routes/ScheduledJobsPage", () => ({
  ScheduledJobsPage: () => <div>scheduled-jobs-page</div>,
}));

vi.mock("./routes/SkillEditorPage", () => ({
  SkillEditorPage: () => <div>skill-editor-page</div>,
}));

vi.mock("./routes/ProviderListPage", () => ({
  ProviderListPage: () => <div>provider-list-page</div>,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App routes", () => {
  it("routes representative public, protected, callback, and fallback paths", async () => {
    const { unmount } = renderAt("/features/search");
    expect(await screen.findByText("feature-search-page")).toBeInTheDocument();
    unmount();

    const termsRoute = renderAt("/terms");
    expect(await screen.findByText("terms-page")).toBeInTheDocument();
    termsRoute.unmount();

    const chatDefaultsRoute = renderAt("/features/chat-defaults");
    expect(await screen.findByText("feature-chat-defaults-page")).toBeInTheDocument();
    chatDefaultsRoute.unmount();

    const branchingRoute = renderAt("/features/branching");
    expect(await screen.findByText("feature-branching-page")).toBeInTheDocument();
    branchingRoute.unmount();

    const audioRoute = renderAt("/features/audio-generation");
    expect(await screen.findByText("feature-audio-generation-page")).toBeInTheDocument();
    audioRoute.unmount();

    const themesRoute = renderAt("/features/themes");
    expect(await screen.findByText("feature-themes-page")).toBeInTheDocument();
    themesRoute.unmount();

    const chatRoute = renderAt("/app/chat/chats_1");
    expect(await screen.findByText("chat-page")).toBeInTheDocument();
    chatRoute.unmount();

    const newPersonaRoute = renderAt("/app/personas/new");
    expect(await screen.findByText("persona-editor-page")).toBeInTheDocument();
    newPersonaRoute.unmount();

    const editPersonaRoute = renderAt("/app/personas/personas_1/edit");
    expect(await screen.findByText("persona-editor-page")).toBeInTheDocument();
    editPersonaRoute.unmount();

    const protectedRoute = renderAt("/app/settings/jobs");
    expect(await screen.findByText("scheduled-jobs-page")).toBeInTheDocument();
    protectedRoute.unmount();

    const providersRoute = renderAt("/app/settings/providers");
    expect(await screen.findByText("provider-list-page")).toBeInTheDocument();
    providersRoute.unmount();

    const newSkillRoute = renderAt("/app/settings/skills/new");
    expect(await screen.findByText("skill-editor-page")).toBeInTheDocument();
    newSkillRoute.unmount();

    const callbackRoute = renderAt("/oauth/slack/callback");
    expect(screen.getByText("oauth:slack")).toBeInTheDocument();
    callbackRoute.unmount();

    const microsoftCallbackRoute = renderAt("/oauth/microsoft/callback");
    expect(screen.getByText("oauth:microsoft")).toBeInTheDocument();
    microsoftCallbackRoute.unmount();

    renderAt("/not-a-real-route");
    expect(screen.getByText("404")).toBeInTheDocument();
  });

  it("renders a route error boundary for public lazy route failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderAt("/features/automated-tasks");

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("An unexpected error occurred. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText("chunk failed")).not.toBeInTheDocument();

    errorSpy.mockRestore();
  });
});
