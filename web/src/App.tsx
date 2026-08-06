import { useLocation, useRoutes, type RouteObject } from "react-router-dom";
import { AppNotFound } from "./app-routing/AppNotFound";
import { authenticatedRoutes } from "./app-routing/authenticatedRoutes";
import { publicRoutes } from "./app-routing/publicRoutes";
import { isPublicSeoPath } from "./lib/seoShell";

const routes: RouteObject[] = [
  ...publicRoutes,
  ...authenticatedRoutes,
  { path: "*", element: <AppNotFound /> },
];

export function App() {
  const location = useLocation();
  const routeContent = useRoutes(routes);
  const routeOwnsMetadata = isPublicSeoPath(location.pathname) ||
    location.pathname === "/openrouter/edge/callback";

  return (
    <>
      {!routeOwnsMetadata && <DefaultAppMetadata />}
      {routeContent}
    </>
  );
}

function DefaultAppMetadata() {
  return (
    <>
      <title>NanthAI Edge | AI Workspace</title>
      <meta
        name="description"
        content="NanthAI Edge is the cross-platform AI workspace for 300+ models, research, AI skills, sandboxed analysis, and Word, Excel, and PowerPoint creation."
      />
      <meta name="robots" content="index, follow" />
    </>
  );
}
