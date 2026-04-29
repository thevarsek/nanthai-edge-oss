import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useConvexAuth, useMutation } from "convex/react";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "@convex/_generated/api";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { useSharedData } from "@/hooks/useSharedData";

interface AuthGuardProps {
  children: React.ReactNode;
  /** If true (default), redirects to /onboarding when onboarding is not complete */
  requireOnboarding?: boolean;
}

/**
 * Protects all /app/* routes and the /onboarding route.
 * - Unauthenticated users → /sign-in
 * - Clerk signed-in but Convex not yet authenticated → loading spinner
 * - Authenticated + no preferences row → creates one with defaults (shows spinner)
 * - Authenticated + onboarding incomplete → /onboarding (unless requireOnboarding=false)
 * - Authenticated + onboarding complete → renders children
 */
export function AuthGuard({ children, requireOnboarding = true }: AuthGuardProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading: isConvexLoading, isAuthenticated: isConvexAuthenticated } = useConvexAuth();
  const location = useLocation();
  const { t } = useTranslation();
  const { prefs, proStatus } = useSharedData();

  const ensurePrefs = useMutation(api.preferences.mutations.ensureUserPreferences);
  const ensureFiredRef = useRef(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const runEnsurePrefs = useCallback(async () => {
    setBootstrapError(null);
    ensureFiredRef.current = true;
    try {
      await ensurePrefs({});
    } catch (error) {
      setBootstrapError(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t("something_went_wrong"),
      );
    }
  }, [ensurePrefs, t]);

  // When Convex auth is ready but no preferences row exists (null),
  // fire the ensureUserPreferences mutation once. The reactive
  // getPreferences query will pick up the new row automatically.
  useEffect(() => {
    if (
      isConvexAuthenticated &&
      prefs === null &&
      !ensureFiredRef.current
    ) {
      // Auth bootstrap intentionally creates missing prefs from the guard effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void runEnsurePrefs();
    }
    // Reset the guard if the user signs out and back in
    if (!isConvexAuthenticated) {
      ensureFiredRef.current = false;
      setBootstrapError(null);
    }
  }, [isConvexAuthenticated, prefs, runEnsurePrefs]);

  // Clerk is still loading
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Not signed in → redirect to sign-in
  if (!isSignedIn) {
    return <Navigate to="/sign-in" state={{ from: location }} replace />;
  }

  // Convex auth is still establishing (token being fetched/confirmed).
  // Without this check, queries run without auth after a password reset or
  // slow token mint, returning empty data instead of the user's real data.
  if (isConvexLoading || !isConvexAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Preferences still loading (undefined = query in flight) or being
  // auto-created (null = ensureUserPreferences mutation in progress).
  if (prefs === null && bootstrapError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="max-w-md w-full rounded-2xl border border-border/50 bg-surface-2 p-6 text-center space-y-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t("something_went_wrong")}
          </h2>
          <p className="text-sm text-foreground/60">
            {bootstrapError}
          </p>
          <button
            onClick={() => void runEnsurePrefs()}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {t("retry")}
          </button>
        </div>
      </div>
    );
  }

  if (prefs === undefined || prefs === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (proStatus === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (requireOnboarding && !prefs.onboardingCompleted) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
