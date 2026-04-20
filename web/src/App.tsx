import { lazy, Suspense } from "react";
import { Route, Routes, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { OpenRouterCallbackPage } from "./pages/OpenRouterCallbackPage";
import { SignInPage } from "./routes/SignInPage";
import { AuthGuard } from "./routes/AuthGuard";
import { RootLayout } from "./routes/RootLayout";
import { AppEmptyState } from "./components/shared/AppEmptyState";
import { LoadingSpinner } from "./components/shared/LoadingSpinner";
import { ProviderOAuthCallbackPage } from "./routes/ProviderOAuthCallbackPage";

// Lazy-loaded marketing/public pages
const HomePage = lazy(() =>
  import("./pages/HomePage").then((m) => ({ default: m.HomePage })),
);
const PrivacyPage = lazy(() =>
  import("./pages/PrivacyPage").then((m) => ({ default: m.PrivacyPage })),
);
const TermsPage = lazy(() =>
  import("./pages/TermsPage").then((m) => ({ default: m.TermsPage })),
);
const SupportPage = lazy(() =>
  import("./pages/SupportPage").then((m) => ({ default: m.SupportPage })),
);
const LicensingPage = lazy(() =>
  import("./pages/LicensingPage").then((m) => ({ default: m.LicensingPage })),
);
const FeaturesIndexPage = lazy(() =>
  import("./pages/features/FeaturesIndexPage").then((m) => ({ default: m.FeaturesIndexPage })),
);

// Lazy-loaded app routes
const ChatPage = lazy(() =>
  import("./routes/ChatPage").then((m) => ({ default: m.ChatPage })),
);
const PersonasPage = lazy(() =>
  import("./routes/PersonasPage").then((m) => ({ default: m.PersonasPage })),
);
const PersonaEditorPage = lazy(() =>
  import("./routes/PersonaEditorPage").then((m) => ({ default: m.PersonaEditorPage })),
);
const SettingsPage = lazy(() =>
  import("./routes/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const SkillsPage = lazy(() =>
  import("./routes/SkillsPage").then((m) => ({ default: m.SkillsPage })),
);
const SkillEditorPage = lazy(() =>
  import("./routes/SkillEditorPage").then((m) => ({ default: m.SkillEditorPage })),
);
const SkillDetailPage = lazy(() =>
  import("./routes/SkillDetailPage").then((m) => ({ default: m.SkillDetailPage })),
);
const MemoryPage = lazy(() =>
  import("./routes/MemoryPage").then((m) => ({ default: m.MemoryPage })),
);
const ScheduledJobsPage = lazy(() =>
  import("./routes/ScheduledJobsPage").then((m) => ({ default: m.ScheduledJobsPage })),
);
const KnowledgeBasePage = lazy(() =>
  import("./routes/KnowledgeBasePage").then((m) => ({ default: m.KnowledgeBasePage })),
);
const ProviderListPage = lazy(() =>
  import("./routes/ProviderListPage").then((m) => ({ default: m.ProviderListPage })),
);
const ManageFavoritesPage = lazy(() =>
  import("./routes/ManageFavoritesPage").then((m) => ({ default: m.ManageFavoritesPage })),
);
const IdeascapePage = lazy(() =>
  import("./routes/IdeascapePage").then((m) => ({ default: m.IdeascapePage })),
);
const OnboardingPage = lazy(() =>
  import("./routes/OnboardingPage").then((m) => ({ default: m.OnboardingPage })),
);
const OpenRouterRequiredPage = lazy(() =>
  import("./routes/OpenRouterRequiredPage").then((m) => ({ default: m.OpenRouterRequiredPage })),
);
const OpenRouterConnectPage = lazy(() =>
  import("./routes/OpenRouterConnectPage").then((m) => ({ default: m.OpenRouterConnectPage })),
);

// Lazy-loaded feature pages
const MultiModelChatPage = lazy(() =>
  import("./pages/features/MultiModelChatPage").then((m) => ({ default: m.MultiModelChatPage })),
);
const SearchPage = lazy(() =>
  import("./pages/features/SearchPage").then((m) => ({ default: m.SearchPage })),
);
const IdeascapesPage = lazy(() =>
  import("./pages/features/IdeascapesPage").then((m) => ({ default: m.IdeascapesPage })),
);
const ChatDefaultsPage = lazy(() =>
  import("./pages/features/ChatDefaultsPage").then((m) => ({ default: m.ChatDefaultsPage })),
);
const FoldersPage = lazy(() =>
  import("./pages/features/FoldersPage").then((m) => ({ default: m.FoldersPage })),
);
const AutomatedTasksPage = lazy(() =>
  import("./pages/features/AutomatedTasksPage").then((m) => ({ default: m.AutomatedTasksPage })),
);
const IntegrationsPage = lazy(() =>
  import("./pages/features/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage })),
);
const PersonasFeaturePage = lazy(() =>
  import("./pages/features/PersonasPage").then((m) => ({ default: m.PersonasPage })),
);
const KnowledgeBaseFeaturePage = lazy(() =>
  import("./pages/features/KnowledgeBasePage").then((m) => ({ default: m.KnowledgeBasePage })),
);
const MemoriesFeaturePage = lazy(() =>
  import("./pages/features/MemoriesPage").then((m) => ({ default: m.MemoriesPage })),
);
const ThemesFeaturePage = lazy(() =>
  import("./pages/features/ThemesPage").then((m) => ({ default: m.ThemesPage })),
);
const ProVsFreeFeaturePage = lazy(() =>
  import("./pages/features/ProVsFreePage").then((m) => ({ default: m.ProVsFreePage })),
);
const BYOKFeaturePage = lazy(() =>
  import("./pages/features/BYOKPage").then((m) => ({ default: m.BYOKPage })),
);
const ParticipantOptionsFeaturePage = lazy(() =>
  import("./pages/features/ParticipantOptionsPage").then((m) => ({ default: m.ParticipantOptionsPage })),
);
const BranchingFeaturePage = lazy(() =>
  import("./pages/features/BranchingPage").then((m) => ({ default: m.BranchingPage })),
);
const PriceTransparencyFeaturePage = lazy(() =>
  import("./pages/features/PriceTransparencyPage").then((m) => ({ default: m.PriceTransparencyPage })),
);
const AudioGenerationPage = lazy(() =>
  import("./pages/features/AudioGenerationPage").then((m) => ({ default: m.AudioGenerationPage })),
);
const ImageGenerationPage = lazy(() =>
  import("./pages/features/ImageGenerationPage").then((m) => ({ default: m.ImageGenerationPage })),
);
const VideoGenerationPage = lazy(() =>
  import("./pages/features/VideoGenerationPage").then((m) => ({ default: m.VideoGenerationPage })),
);

function AppSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <LoadingSpinner size="lg" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground gap-4">
      <h1 className="text-5xl font-bold text-foreground/20">404</h1>
      <p className="text-lg text-foreground/60">{t("page_not_found", "Page not found")}</p>
      <Link to="/" className="text-sm text-primary hover:underline">
        {t("go_home", "Go home")}
      </Link>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      {/* Public / marketing routes */}
      <Route path="/" element={<AppSuspense><HomePage /></AppSuspense>} />
      <Route path="/privacy" element={<AppSuspense><PrivacyPage /></AppSuspense>} />
      <Route path="/terms" element={<AppSuspense><TermsPage /></AppSuspense>} />
      <Route path="/support" element={<AppSuspense><SupportPage /></AppSuspense>} />
      <Route path="/licensing" element={<AppSuspense><LicensingPage /></AppSuspense>} />
      {/* Feature pages */}
      <Route path="/features" element={<AppSuspense><FeaturesIndexPage /></AppSuspense>} />
      <Route
        path="/features/multi-model-chat"
        element={
          <AppSuspense>
            <MultiModelChatPage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/search"
        element={
          <AppSuspense>
            <SearchPage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/ideascapes"
        element={
          <AppSuspense>
            <IdeascapesPage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/chat-defaults"
        element={
          <AppSuspense>
            <ChatDefaultsPage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/folders"
        element={
          <AppSuspense>
            <FoldersPage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/automated-tasks"
        element={
          <AppSuspense>
            <AutomatedTasksPage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/integrations"
        element={
          <AppSuspense>
            <IntegrationsPage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/personas"
        element={
          <AppSuspense>
            <PersonasFeaturePage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/knowledge-base"
        element={
          <AppSuspense>
            <KnowledgeBaseFeaturePage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/memories"
        element={
          <AppSuspense>
            <MemoriesFeaturePage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/themes"
        element={
          <AppSuspense>
            <ThemesFeaturePage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/pro-vs-free"
        element={
          <AppSuspense>
            <ProVsFreeFeaturePage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/byok"
        element={
          <AppSuspense>
            <BYOKFeaturePage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/participant-options"
        element={
          <AppSuspense>
            <ParticipantOptionsFeaturePage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/branching"
        element={
          <AppSuspense>
            <BranchingFeaturePage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/price-transparency"
        element={
          <AppSuspense>
            <PriceTransparencyFeaturePage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/audio-generation"
        element={
          <AppSuspense>
            <AudioGenerationPage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/image-generation"
        element={
          <AppSuspense>
            <ImageGenerationPage />
          </AppSuspense>
        }
      />
      <Route
        path="/features/video-generation"
        element={
          <AppSuspense>
            <VideoGenerationPage />
          </AppSuspense>
        }
      />
      {/* Auth */}
      <Route path="/sign-in/*" element={<SignInPage />} />

      {/* Native app OAuth relay — DO NOT REMOVE OR MODIFY */}
      <Route path="/openrouter/edge/callback" element={<OpenRouterCallbackPage />} />
      {/* Web PWA OpenRouter callback */}
      <Route
        path="/openrouter/callback"
        element={
          <AppSuspense>
            <OpenRouterConnectPage />
          </AppSuspense>
        }
      />
      <Route
        path="/oauth/google/callback"
        element={<ProviderOAuthCallbackPage provider="google" />}
      />
      <Route
        path="/oauth/microsoft/callback"
        element={<ProviderOAuthCallbackPage provider="microsoft" />}
      />
      <Route
        path="/oauth/notion/callback"
        element={<ProviderOAuthCallbackPage provider="notion" />}
      />
      <Route
        path="/oauth/slack/callback"
        element={<ProviderOAuthCallbackPage provider="slack" />}
      />

      {/* Auth-protected app routes */}
      <Route
        path="/app/*"
        element={
          <AuthGuard>
            <AppSuspense>
              <RootLayout />
            </AppSuspense>
          </AuthGuard>
        }
      >
        {/* Default right pane: empty state (sidebar shows chat list) */}
        <Route index element={<AppEmptyState />} />
        <Route path="chat" element={<AppEmptyState />} />
        <Route
          path="chat/:chatId"
          element={
            <AppSuspense>
              <ChatPage />
            </AppSuspense>
          }
        />
        <Route
          path="ideascape/:chatId"
          element={
            <AppSuspense>
              <IdeascapePage />
            </AppSuspense>
          }
        />
        <Route
          path="personas"
          element={
            <AppSuspense>
              <PersonasPage />
            </AppSuspense>
          }
        />
        <Route
          path="personas/new"
          element={
            <AppSuspense>
              <PersonaEditorPage />
            </AppSuspense>
          }
        />
        <Route
          path="personas/:personaId/edit"
          element={
            <AppSuspense>
              <PersonaEditorPage />
            </AppSuspense>
          }
        />
        <Route
          path="settings"
          element={
            <AppSuspense>
              <SettingsPage />
            </AppSuspense>
          }
        />
        <Route
          path="settings/skills"
          element={
            <AppSuspense>
              <SkillsPage />
            </AppSuspense>
          }
        />
        <Route
          path="settings/skills/new"
          element={
            <AppSuspense>
              <SkillEditorPage />
            </AppSuspense>
          }
        />
        <Route
          path="settings/skills/:skillId/edit"
          element={
            <AppSuspense>
              <SkillEditorPage />
            </AppSuspense>
          }
        />
        <Route
          path="settings/skills/:skillId"
          element={
            <AppSuspense>
              <SkillDetailPage />
            </AppSuspense>
          }
        />
        <Route
          path="settings/memory"
          element={
            <AppSuspense>
              <MemoryPage />
            </AppSuspense>
          }
        />
        <Route
          path="settings/jobs"
          element={
            <AppSuspense>
              <ScheduledJobsPage />
            </AppSuspense>
          }
        />
        <Route
          path="settings/knowledge"
          element={
            <AppSuspense>
              <KnowledgeBasePage />
            </AppSuspense>
          }
        />
        <Route
          path="settings/providers"
          element={
            <AppSuspense>
              <ProviderListPage />
            </AppSuspense>
          }
        />
        <Route
          path="settings/favorites"
          element={
            <AppSuspense>
              <ManageFavoritesPage />
            </AppSuspense>
          }
        />
      </Route>

      {/* Onboarding (protected but outside main layout) */}
      <Route
        path="/onboarding"
        element={
          <AuthGuard requireOnboarding={false}>
            <AppSuspense>
              <OnboardingPage />
            </AppSuspense>
          </AuthGuard>
        }
      />
      <Route
        path="/openrouter-required"
        element={
          <AuthGuard requireOnboarding={false}>
            <AppSuspense>
              <OpenRouterRequiredPage />
            </AppSuspense>
          </AuthGuard>
        }
      />

      {/* 404 catch-all */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
