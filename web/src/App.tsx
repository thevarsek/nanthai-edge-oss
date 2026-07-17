import { useRoutes, type RouteObject } from "react-router-dom";
import { AppNotFound } from "./app-routing/AppNotFound";
import { authenticatedRoutes } from "./app-routing/authenticatedRoutes";
import { publicRoutes } from "./app-routing/publicRoutes";

const routes: RouteObject[] = [
  ...publicRoutes,
  ...authenticatedRoutes,
  { path: "*", element: <AppNotFound /> },
];

export function App() {
  return useRoutes(routes);
}
