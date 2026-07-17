/* eslint-disable react-refresh/only-export-components -- route table, not a refresh boundary */
import { lazy, type ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { AppEmptyState } from "@/components/shared/AppEmptyState";
import { AuthGuard } from "@/routes/AuthGuard";
import { RootLayout } from "@/routes/RootLayout";
import { AppNotFound } from "./AppNotFound";
import { AppRouteBoundary } from "./AppRouteBoundary";

const ChatPage = lazy(() =>
  import("@/routes/ChatPage").then((module) => ({ default: module.ChatPage })),
);
const PersonasPage = lazy(() =>
  import("@/routes/PersonasPage").then((module) => ({ default: module.PersonasPage })),
);
const PersonaEditorPage = lazy(() =>
  import("@/routes/PersonaEditorPage").then((module) => ({ default: module.PersonaEditorPage })),
);
const SettingsPage = lazy(() =>
  import("@/routes/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
const SkillsPage = lazy(() =>
  import("@/routes/SkillsPage").then((module) => ({ default: module.SkillsPage })),
);
const SkillEditorPage = lazy(() =>
  import("@/routes/SkillEditorPage").then((module) => ({ default: module.SkillEditorPage })),
);
const SkillDetailPage = lazy(() =>
  import("@/routes/SkillDetailPage").then((module) => ({ default: module.SkillDetailPage })),
);
const MemoryPage = lazy(() =>
  import("@/routes/MemoryPage").then((module) => ({ default: module.MemoryPage })),
);
const ScheduledJobsPage = lazy(() =>
  import("@/routes/ScheduledJobsPage").then((module) => ({ default: module.ScheduledJobsPage })),
);
const KnowledgeBasePage = lazy(() =>
  import("@/routes/KnowledgeBasePage").then((module) => ({ default: module.KnowledgeBasePage })),
);
const ProviderListPage = lazy(() =>
  import("@/routes/ProviderListPage").then((module) => ({ default: module.ProviderListPage })),
);
const ManageFavoritesPage = lazy(() =>
  import("@/routes/ManageFavoritesPage").then((module) => ({
    default: module.ManageFavoritesPage,
  })),
);
const IdeascapePage = lazy(() =>
  import("@/routes/IdeascapePage").then((module) => ({ default: module.IdeascapePage })),
);
const OnboardingPage = lazy(() =>
  import("@/routes/OnboardingPage").then((module) => ({ default: module.OnboardingPage })),
);
const OpenRouterRequiredPage = lazy(() =>
  import("@/routes/OpenRouterRequiredPage").then((module) => ({
    default: module.OpenRouterRequiredPage,
  })),
);

function suspended(element: ReactNode) {
  return <AppRouteBoundary>{element}</AppRouteBoundary>;
}

const appChildren: RouteObject[] = [
  { index: true, element: <AppEmptyState /> },
  { path: "chat", element: <AppEmptyState /> },
  { path: "chat/:chatId", element: suspended(<ChatPage />) },
  { path: "ideascape/:chatId", element: suspended(<IdeascapePage />) },
  { path: "personas", element: suspended(<PersonasPage />) },
  { path: "personas/new", element: suspended(<PersonaEditorPage />) },
  { path: "personas/:personaId/edit", element: suspended(<PersonaEditorPage />) },
  { path: "settings", element: suspended(<SettingsPage />) },
  { path: "settings/skills", element: suspended(<SkillsPage />) },
  { path: "settings/skills/new", element: suspended(<SkillEditorPage />) },
  { path: "settings/skills/:skillId/edit", element: suspended(<SkillEditorPage />) },
  { path: "settings/skills/:skillId", element: suspended(<SkillDetailPage />) },
  { path: "settings/memory", element: suspended(<MemoryPage />) },
  { path: "settings/jobs", element: suspended(<ScheduledJobsPage />) },
  { path: "settings/knowledge", element: suspended(<KnowledgeBasePage />) },
  { path: "settings/providers", element: suspended(<ProviderListPage />) },
  { path: "settings/favorites", element: suspended(<ManageFavoritesPage />) },
  { path: "*", element: <AppNotFound homeTarget="/app" /> },
];

export const authenticatedRoutes: RouteObject[] = [
  {
    path: "/app",
    element: (
      <AuthGuard>
        <AppRouteBoundary resetOnLocationChange={false}>
          <RootLayout />
        </AppRouteBoundary>
      </AuthGuard>
    ),
    children: appChildren,
  },
  {
    path: "/onboarding",
    element: (
      <AuthGuard requireOnboarding={false}>
        {suspended(<OnboardingPage />)}
      </AuthGuard>
    ),
  },
  {
    path: "/openrouter-required",
    element: (
      <AuthGuard requireOnboarding={false}>
        {suspended(<OpenRouterRequiredPage />)}
      </AuthGuard>
    ),
  },
];
