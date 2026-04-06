import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { TermsPage } from "./pages/TermsPage";
import { SupportPage } from "./pages/SupportPage";
import { LicensingPage } from "./pages/LicensingPage";
import { FeaturesIndexPage } from "./pages/features/FeaturesIndexPage";
import { OpenRouterCallbackPage } from "./pages/OpenRouterCallbackPage";
import { SignInPage } from "./routes/SignInPage";
import { AuthGuard } from "./routes/AuthGuard";
import { RootLayout } from "./routes/RootLayout";
import { AppEmptyState } from "./components/shared/AppEmptyState";
import { LoadingSpinner } from "./components/shared/LoadingSpinner";
import { ProviderOAuthCallbackPage } from "./routes/ProviderOAuthCallbackPage";

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

export function App() {
  return (
    <Routes>
      {/* Public / marketing routes */}
      <Route path="/" element={<HomePage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/support" element={<SupportPage />} />
      <Route path="/licensing" element={<LicensingPage />} />
      {/* Feature pages */}
      <Route path="/features" element={<FeaturesIndexPage />} />
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
    </Routes>
  );
}
