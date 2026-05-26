import { render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Outlet } from "react-router-dom";
import { App } from "./App";

const { routeMocks } = vi.hoisted(() => ({
  routeMocks: {
    automatedTasksShouldThrow: false,
  },
}));

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

vi.mock("./pages/PrivacyPage", () => ({
  PrivacyPage: () => <div>privacy-page</div>,
}));

vi.mock("./pages/LicensingPage", () => ({
  LicensingPage: () => <div>licensing-page</div>,
}));

vi.mock("./pages/features/FeaturesIndexPage", () => ({
  FeaturesIndexPage: () => <div>features-index-page</div>,
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

vi.mock("./pages/features/MultiModelChatPage", () => ({
  MultiModelChatPage: () => <div>feature-multi-model-chat-page</div>,
}));

vi.mock("./pages/features/IdeascapesPage", () => ({
  IdeascapesPage: () => <div>feature-ideascapes-page</div>,
}));

vi.mock("./pages/features/ChatDefaultsPage", () => ({
  ChatDefaultsPage: () => <div>feature-chat-defaults-page</div>,
}));

vi.mock("./pages/features/FoldersPage", () => ({
  FoldersPage: () => <div>feature-folders-page</div>,
}));

vi.mock("./pages/features/AutomatedTasksPage", () => ({
  AutomatedTasksPage: () => {
    if (routeMocks.automatedTasksShouldThrow) {
      throw new Error("chunk failed");
    }
    return <div>feature-automated-tasks-page</div>;
  },
}));

vi.mock("./pages/features/IntegrationsPage", () => ({
  IntegrationsPage: () => <div>feature-integrations-page</div>,
}));

vi.mock("./pages/features/PersonasPage", () => ({
  PersonasPage: () => <div>feature-personas-page</div>,
}));

vi.mock("./pages/features/KnowledgeBasePage", () => ({
  KnowledgeBasePage: () => <div>feature-knowledge-base-page</div>,
}));

vi.mock("./pages/features/BranchingPage", () => ({
  BranchingPage: () => <div>feature-branching-page</div>,
}));

vi.mock("./pages/features/ProVsFreePage", () => ({
  ProVsFreePage: () => <div>feature-pro-vs-free-page</div>,
}));

vi.mock("./pages/features/BYOKPage", () => ({
  BYOKPage: () => <div>feature-byok-page</div>,
}));

vi.mock("./pages/features/ParticipantOptionsPage", () => ({
  ParticipantOptionsPage: () => <div>feature-participant-options-page</div>,
}));

vi.mock("./pages/features/AudioGenerationPage", () => ({
  AudioGenerationPage: () => <div>feature-audio-generation-page</div>,
}));

vi.mock("./pages/features/ImageGenerationPage", () => ({
  ImageGenerationPage: () => <div>feature-image-generation-page</div>,
}));

vi.mock("./pages/features/VideoGenerationPage", () => ({
  VideoGenerationPage: () => <div>feature-video-generation-page</div>,
}));

vi.mock("./pages/features/ThemesPage", () => ({
  ThemesPage: () => <div>feature-themes-page</div>,
}));

vi.mock("./routes/ChatPage", () => ({
  ChatPage: () => <div>chat-page</div>,
}));

vi.mock("./routes/IdeascapePage", () => ({
  IdeascapePage: () => <div>ideascape-page</div>,
}));

vi.mock("./routes/PersonasPage", () => ({
  PersonasPage: () => <div>personas-page</div>,
}));

vi.mock("./routes/PersonaEditorPage", () => ({
  PersonaEditorPage: () => <div>persona-editor-page</div>,
}));

vi.mock("./routes/SettingsPage", () => ({
  SettingsPage: () => <div>settings-page</div>,
}));

vi.mock("./routes/SkillsPage", () => ({
  SkillsPage: () => <div>skills-page</div>,
}));

vi.mock("./routes/ScheduledJobsPage", () => ({
  ScheduledJobsPage: () => <div>scheduled-jobs-page</div>,
}));

vi.mock("./routes/SkillEditorPage", () => ({
  SkillEditorPage: () => <div>skill-editor-page</div>,
}));

vi.mock("./routes/SkillDetailPage", () => ({
  SkillDetailPage: () => <div>skill-detail-page</div>,
}));

vi.mock("./routes/ProviderListPage", () => ({
  ProviderListPage: () => <div>provider-list-page</div>,
}));

vi.mock("./routes/MemoryPage", () => ({
  MemoryPage: () => <div>memory-page</div>,
}));

vi.mock("./routes/KnowledgeBasePage", () => ({
  KnowledgeBasePage: () => <div>knowledge-page</div>,
}));

vi.mock("./routes/ManageFavoritesPage", () => ({
  ManageFavoritesPage: () => <div>favorites-page</div>,
}));

vi.mock("./routes/OnboardingPage", () => ({
  OnboardingPage: () => <div>onboarding-page</div>,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App routes", () => {
  beforeEach(() => {
    routeMocks.automatedTasksShouldThrow = false;
  });

  it("routes representative public, protected, callback, and fallback paths", async () => {
    const { unmount } = renderAt("/features/search");
    expect(await screen.findByText("feature-search-page")).toBeInTheDocument();
    unmount();

    const privacyRoute = renderAt("/privacy");
    expect(await screen.findByText("privacy-page")).toBeInTheDocument();
    privacyRoute.unmount();

    const termsRoute = renderAt("/terms");
    expect(await screen.findByText("terms-page")).toBeInTheDocument();
    termsRoute.unmount();

    const licensingRoute = renderAt("/licensing");
    expect(await screen.findByText("licensing-page")).toBeInTheDocument();
    licensingRoute.unmount();

    const featuresRoute = renderAt("/features");
    expect(await screen.findByText("features-index-page")).toBeInTheDocument();
    featuresRoute.unmount();

    const multiModelRoute = renderAt("/features/multi-model-chat");
    expect(await screen.findByText("feature-multi-model-chat-page")).toBeInTheDocument();
    multiModelRoute.unmount();

    const ideascapesFeatureRoute = renderAt("/features/ideascapes");
    expect(await screen.findByText("feature-ideascapes-page")).toBeInTheDocument();
    ideascapesFeatureRoute.unmount();

    const chatDefaultsRoute = renderAt("/features/chat-defaults");
    expect(await screen.findByText("feature-chat-defaults-page")).toBeInTheDocument();
    chatDefaultsRoute.unmount();

    const foldersRoute = renderAt("/features/folders");
    expect(await screen.findByText("feature-folders-page")).toBeInTheDocument();
    foldersRoute.unmount();

    const automatedTasksRoute = renderAt("/features/automated-tasks");
    expect(await screen.findByText("feature-automated-tasks-page")).toBeInTheDocument();
    automatedTasksRoute.unmount();

    const integrationsRoute = renderAt("/features/integrations");
    expect(await screen.findByText("feature-integrations-page")).toBeInTheDocument();
    integrationsRoute.unmount();

    const personasFeatureRoute = renderAt("/features/personas");
    expect(await screen.findByText("feature-personas-page")).toBeInTheDocument();
    personasFeatureRoute.unmount();

    const knowledgeFeatureRoute = renderAt("/features/knowledge-base");
    expect(await screen.findByText("feature-knowledge-base-page")).toBeInTheDocument();
    knowledgeFeatureRoute.unmount();

    const proVsFreeRoute = renderAt("/features/pro-vs-free");
    expect(await screen.findByText("feature-pro-vs-free-page")).toBeInTheDocument();
    proVsFreeRoute.unmount();

    const byokRoute = renderAt("/features/byok");
    expect(await screen.findByText("feature-byok-page")).toBeInTheDocument();
    byokRoute.unmount();

    const participantOptionsRoute = renderAt("/features/participant-options");
    expect(await screen.findByText("feature-participant-options-page")).toBeInTheDocument();
    participantOptionsRoute.unmount();

    const branchingRoute = renderAt("/features/branching");
    expect(await screen.findByText("feature-branching-page")).toBeInTheDocument();
    branchingRoute.unmount();

    const audioRoute = renderAt("/features/audio-generation");
    expect(await screen.findByText("feature-audio-generation-page")).toBeInTheDocument();
    audioRoute.unmount();

    const imageRoute = renderAt("/features/image-generation");
    expect(await screen.findByText("feature-image-generation-page")).toBeInTheDocument();
    imageRoute.unmount();

    const themesRoute = renderAt("/features/themes");
    expect(await screen.findByText("feature-themes-page")).toBeInTheDocument();
    themesRoute.unmount();

    const videoRoute = renderAt("/features/video-generation");
    expect(await screen.findByText("feature-video-generation-page")).toBeInTheDocument();
    videoRoute.unmount();

    const appIndexRoute = renderAt("/app");
    expect(await screen.findByText("app-empty-state")).toBeInTheDocument();
    appIndexRoute.unmount();

    const appChatIndexRoute = renderAt("/app/chat");
    expect(await screen.findByText("app-empty-state")).toBeInTheDocument();
    appChatIndexRoute.unmount();

    const chatRoute = renderAt("/app/chat/chats_1");
    expect(await screen.findByText("chat-page")).toBeInTheDocument();
    chatRoute.unmount();

    const ideascapeRoute = renderAt("/app/ideascape/chats_1");
    expect(await screen.findByText("ideascape-page")).toBeInTheDocument();
    ideascapeRoute.unmount();

    const personasRoute = renderAt("/app/personas");
    expect(await screen.findByText("personas-page")).toBeInTheDocument();
    personasRoute.unmount();

    const newPersonaRoute = renderAt("/app/personas/new");
    expect(await screen.findByText("persona-editor-page")).toBeInTheDocument();
    newPersonaRoute.unmount();

    const editPersonaRoute = renderAt("/app/personas/personas_1/edit");
    expect(await screen.findByText("persona-editor-page")).toBeInTheDocument();
    editPersonaRoute.unmount();

    const settingsRoute = renderAt("/app/settings");
    expect(await screen.findByText("settings-page")).toBeInTheDocument();
    settingsRoute.unmount();

    const skillsRoute = renderAt("/app/settings/skills");
    expect(await screen.findByText("skills-page")).toBeInTheDocument();
    skillsRoute.unmount();

    const protectedRoute = renderAt("/app/settings/jobs");
    expect(await screen.findByText("scheduled-jobs-page")).toBeInTheDocument();
    protectedRoute.unmount();

    const providersRoute = renderAt("/app/settings/providers");
    expect(await screen.findByText("provider-list-page")).toBeInTheDocument();
    providersRoute.unmount();

    const newSkillRoute = renderAt("/app/settings/skills/new");
    expect(await screen.findByText("skill-editor-page")).toBeInTheDocument();
    newSkillRoute.unmount();

    const editSkillRoute = renderAt("/app/settings/skills/skills_1/edit");
    expect(await screen.findByText("skill-editor-page")).toBeInTheDocument();
    editSkillRoute.unmount();

    const skillDetailRoute = renderAt("/app/settings/skills/skills_1");
    expect(await screen.findByText("skill-detail-page")).toBeInTheDocument();
    skillDetailRoute.unmount();

    const memoryRoute = renderAt("/app/settings/memory");
    expect(await screen.findByText("memory-page")).toBeInTheDocument();
    memoryRoute.unmount();

    const knowledgeRoute = renderAt("/app/settings/knowledge");
    expect(await screen.findByText("knowledge-page")).toBeInTheDocument();
    knowledgeRoute.unmount();

    const favoritesRoute = renderAt("/app/settings/favorites");
    expect(await screen.findByText("favorites-page")).toBeInTheDocument();
    favoritesRoute.unmount();

    const onboardingRoute = renderAt("/onboarding");
    expect(await screen.findByText("onboarding-page")).toBeInTheDocument();
    onboardingRoute.unmount();

    const callbackRoute = renderAt("/oauth/slack/callback");
    expect(screen.getByText("oauth:slack")).toBeInTheDocument();
    callbackRoute.unmount();

    const microsoftCallbackRoute = renderAt("/oauth/microsoft/callback");
    expect(screen.getByText("oauth:microsoft")).toBeInTheDocument();
    microsoftCallbackRoute.unmount();

    renderAt("/not-a-real-route");
    expect(screen.getByText("404")).toBeInTheDocument();
  }, 15000);

  it("renders a route error boundary for public lazy route failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    routeMocks.automatedTasksShouldThrow = true;

    renderAt("/features/automated-tasks");

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("An unexpected error occurred. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText("chunk failed")).not.toBeInTheDocument();

    errorSpy.mockRestore();
  });
});
