/* eslint-disable react-refresh/only-export-components -- route table, not a refresh boundary */
import { lazy, type ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { OpenRouterCallbackPage } from "@/pages/OpenRouterCallbackPage";
import { MobileDrivePickerPage } from "@/routes/MobileDrivePickerPage";
import { ProviderOAuthCallbackPage } from "@/routes/ProviderOAuthCallbackPage";
import { SignInPage } from "@/routes/SignInPage";
import { AppRouteBoundary } from "./AppRouteBoundary";

const HomePage = lazy(() =>
  import("@/pages/HomePage").then((module) => ({ default: module.HomePage })),
);
const PrivacyPage = lazy(() =>
  import("@/pages/PrivacyPage").then((module) => ({ default: module.PrivacyPage })),
);
const TermsPage = lazy(() =>
  import("@/pages/TermsPage").then((module) => ({ default: module.TermsPage })),
);
const SupportPage = lazy(() =>
  import("@/pages/SupportPage").then((module) => ({ default: module.SupportPage })),
);
const LicensingPage = lazy(() =>
  import("@/pages/LicensingPage").then((module) => ({ default: module.LicensingPage })),
);
const FeaturesIndexPage = lazy(() =>
  import("@/pages/features/FeaturesIndexPage").then((module) => ({
    default: module.FeaturesIndexPage,
  })),
);
const MultiModelChatPage = lazy(() =>
  import("@/pages/features/MultiModelChatPage").then((module) => ({
    default: module.MultiModelChatPage,
  })),
);
const SearchPage = lazy(() =>
  import("@/pages/features/SearchPage").then((module) => ({ default: module.SearchPage })),
);
const IdeascapesPage = lazy(() =>
  import("@/pages/features/IdeascapesPage").then((module) => ({
    default: module.IdeascapesPage,
  })),
);
const ChatDefaultsPage = lazy(() =>
  import("@/pages/features/ChatDefaultsPage").then((module) => ({
    default: module.ChatDefaultsPage,
  })),
);
const FoldersPage = lazy(() =>
  import("@/pages/features/FoldersPage").then((module) => ({ default: module.FoldersPage })),
);
const AutomatedTasksPage = lazy(() =>
  import("@/pages/features/AutomatedTasksPage").then((module) => ({
    default: module.AutomatedTasksPage,
  })),
);
const IntegrationsPage = lazy(() =>
  import("@/pages/features/IntegrationsPage").then((module) => ({
    default: module.IntegrationsPage,
  })),
);
const PersonasFeaturePage = lazy(() =>
  import("@/pages/features/PersonasPage").then((module) => ({ default: module.PersonasPage })),
);
const KnowledgeBaseFeaturePage = lazy(() =>
  import("@/pages/features/KnowledgeBasePage").then((module) => ({
    default: module.KnowledgeBasePage,
  })),
);
const MemoriesFeaturePage = lazy(() =>
  import("@/pages/features/MemoriesPage").then((module) => ({
    default: module.MemoriesPage,
  })),
);
const ThemesFeaturePage = lazy(() =>
  import("@/pages/features/ThemesPage").then((module) => ({ default: module.ThemesPage })),
);
const ProVsFreeFeaturePage = lazy(() =>
  import("@/pages/features/ProVsFreePage").then((module) => ({
    default: module.ProVsFreePage,
  })),
);
const BYOKFeaturePage = lazy(() =>
  import("@/pages/features/BYOKPage").then((module) => ({ default: module.BYOKPage })),
);
const ParticipantOptionsFeaturePage = lazy(() =>
  import("@/pages/features/ParticipantOptionsPage").then((module) => ({
    default: module.ParticipantOptionsPage,
  })),
);
const BranchingFeaturePage = lazy(() =>
  import("@/pages/features/BranchingPage").then((module) => ({
    default: module.BranchingPage,
  })),
);
const PriceTransparencyFeaturePage = lazy(() =>
  import("@/pages/features/PriceTransparencyPage").then((module) => ({
    default: module.PriceTransparencyPage,
  })),
);
const AudioGenerationPage = lazy(() =>
  import("@/pages/features/AudioGenerationPage").then((module) => ({
    default: module.AudioGenerationPage,
  })),
);
const ImageGenerationPage = lazy(() =>
  import("@/pages/features/ImageGenerationPage").then((module) => ({
    default: module.ImageGenerationPage,
  })),
);
const VideoGenerationPage = lazy(() =>
  import("@/pages/features/VideoGenerationPage").then((module) => ({
    default: module.VideoGenerationPage,
  })),
);
const OpenRouterConnectPage = lazy(() =>
  import("@/routes/OpenRouterConnectPage").then((module) => ({
    default: module.OpenRouterConnectPage,
  })),
);

function suspended(element: ReactNode) {
  return <AppRouteBoundary>{element}</AppRouteBoundary>;
}

export const publicRoutes: RouteObject[] = [
  { path: "/", element: suspended(<HomePage />) },
  { path: "/privacy", element: suspended(<PrivacyPage />) },
  { path: "/terms", element: suspended(<TermsPage />) },
  { path: "/support", element: suspended(<SupportPage />) },
  { path: "/licensing", element: suspended(<LicensingPage />) },
  { path: "/features", element: suspended(<FeaturesIndexPage />) },
  { path: "/features/multi-model-chat", element: suspended(<MultiModelChatPage />) },
  { path: "/features/search", element: suspended(<SearchPage />) },
  { path: "/features/ideascapes", element: suspended(<IdeascapesPage />) },
  { path: "/features/chat-defaults", element: suspended(<ChatDefaultsPage />) },
  { path: "/features/folders", element: suspended(<FoldersPage />) },
  { path: "/features/automated-tasks", element: suspended(<AutomatedTasksPage />) },
  { path: "/features/integrations", element: suspended(<IntegrationsPage />) },
  { path: "/features/personas", element: suspended(<PersonasFeaturePage />) },
  { path: "/features/knowledge-base", element: suspended(<KnowledgeBaseFeaturePage />) },
  { path: "/features/memories", element: suspended(<MemoriesFeaturePage />) },
  { path: "/features/themes", element: suspended(<ThemesFeaturePage />) },
  { path: "/features/pro-vs-free", element: suspended(<ProVsFreeFeaturePage />) },
  { path: "/features/byok", element: suspended(<BYOKFeaturePage />) },
  {
    path: "/features/participant-options",
    element: suspended(<ParticipantOptionsFeaturePage />),
  },
  { path: "/features/branching", element: suspended(<BranchingFeaturePage />) },
  {
    path: "/features/price-transparency",
    element: suspended(<PriceTransparencyFeaturePage />),
  },
  { path: "/features/audio-generation", element: suspended(<AudioGenerationPage />) },
  { path: "/features/image-generation", element: suspended(<ImageGenerationPage />) },
  { path: "/features/video-generation", element: suspended(<VideoGenerationPage />) },
  { path: "/sign-in/*", element: <SignInPage /> },

  // Native app OAuth relay — DO NOT REMOVE OR MODIFY.
  { path: "/openrouter/edge/callback", element: <OpenRouterCallbackPage /> },
  { path: "/openrouter/callback", element: suspended(<OpenRouterConnectPage />) },
  {
    path: "/oauth/google/callback",
    element: <ProviderOAuthCallbackPage provider="google" />,
  },
  {
    path: "/oauth/microsoft/callback",
    element: <ProviderOAuthCallbackPage provider="microsoft" />,
  },
  {
    path: "/oauth/notion/callback",
    element: <ProviderOAuthCallbackPage provider="notion" />,
  },
  {
    path: "/oauth/slack/callback",
    element: <ProviderOAuthCallbackPage provider="slack" />,
  },
  { path: "/mobile-drive-picker", element: <MobileDrivePickerPage /> },
];
