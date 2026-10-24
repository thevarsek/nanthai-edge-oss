/* eslint-disable react-refresh/only-export-components -- route table, not a refresh boundary */
import { marketingPages } from "./marketingPages";
import { publicPath } from "@/lib/publicLocale";
import { PublicLocaleBoundary } from "./PublicLocaleBoundary";
import { contentLanguages } from "@/lib/contentLocale";
import { lazy, type ReactNode } from "react";
import { Navigate, type RouteObject } from "react-router-dom";
import { OpenRouterCallbackPage } from "@/pages/OpenRouterCallbackPage";
import { MobileDrivePickerPage } from "@/routes/MobileDrivePickerPage";
import { ProviderOAuthCallbackPage } from "@/routes/ProviderOAuthCallbackPage";
import { SignInPage } from "@/routes/SignInPage";
import { AppRouteBoundary } from "./AppRouteBoundary";

const ContentPage = lazy(() => import("@/pages/content/ContentPage").then(module => ({ default: module.ContentPage })));

const OpenRouterConnectPage = lazy(() =>
  import("@/routes/OpenRouterConnectPage").then((module) => ({
    default: module.OpenRouterConnectPage,
  })),
);

function suspended(element: ReactNode) {
  return <AppRouteBoundary>{element}</AppRouteBoundary>;
}

const marketingRoutes: RouteObject[] = marketingPages.flatMap(page => {
  const Page = lazy(() => page.load().then(defaultExport => ({ default: defaultExport })));
  return contentLanguages.map(language => ({
    path: publicPath(page.path, language),
    element: <PublicLocaleBoundary language={language}>{suspended(<Page />)}</PublicLocaleBoundary>,
  }));
});

export const publicRoutes: RouteObject[] = [
  ...marketingRoutes,
  ...contentLanguages.filter(language => language !== "en").flatMap(language => [
    { path: `/${language}/guides/:slug?`, element: suspended(<ContentPage />) },
    { path: `/${language}/research/:slug?`, element: suspended(<ContentPage />) },
  ]),
  { path: "/guides", element: suspended(<ContentPage />) },
  { path: "/guides/:slug", element: suspended(<ContentPage />) },
  { path: "/research", element: suspended(<ContentPage />) },
  { path: "/research/:slug", element: suspended(<ContentPage />) },
  { path: "/research/results", element: <Navigate to="/workflows" replace /> },
  { path: "/research/methods", element: <Navigate to="/local-runtime" replace /> },
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
