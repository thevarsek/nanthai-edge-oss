import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { BrowserRouter } from "react-router-dom";
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexReactClient } from "convex/react";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { SharedDataProvider } from "./hooks/SharedDataProvider";
import { ToastProvider } from "./components/shared/Toast";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import "./i18n"; // initializes i18next (side-effect import)
import "./index.css";

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string;

if (!CLERK_KEY) throw new Error("VITE_CLERK_PUBLISHABLE_KEY is not set");
if (!CONVEX_URL) throw new Error("VITE_CONVEX_URL is not set");

const convex = new ConvexReactClient(CONVEX_URL);

if (typeof window !== "undefined") {
  registerSW({ immediate: true });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HelmetProvider>
      <ClerkProvider
        publishableKey={CLERK_KEY}
        afterSignOutUrl="/"
        signInForceRedirectUrl="/app"
      >
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          <BrowserRouter>
            <SharedDataProvider>
              <ToastProvider>
                <ErrorBoundary level="app">
                  <App />
                </ErrorBoundary>
              </ToastProvider>
            </SharedDataProvider>
          </BrowserRouter>
        </ConvexProviderWithClerk>
      </ClerkProvider>
    </HelmetProvider>
  </StrictMode>,
);
