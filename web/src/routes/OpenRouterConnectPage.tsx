import { useEffect, useMemo, useState, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation } from "convex/react";
import { useConvexAuth } from "convex/react";
import { api } from "@convex/_generated/api";
import { exchangeCodeForKey } from "@/lib/pkce";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

type Status = "loading" | "success" | "error";
const AUTH_TIMEOUT_MS = 12000;

/**
 * Handles the web PKCE callback from OpenRouter at /openrouter/callback.
 * Reads ?code= and ?state= from the URL, verifies state against sessionStorage,
 * exchanges the code for an API key, and stores it to Convex via upsertApiKey.
 */
export function OpenRouterConnectPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [authDelayMessage, setAuthDelayMessage] = useState<string>("");
  const upsertApiKey = useMutation(api.scheduledJobs.mutations.upsertApiKey);
  const setOnboardingCompleted = useMutation(api.preferences.mutations.setOnboardingCompleted);
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const didRun = useRef(false);
  const callbackTarget = useMemo(() => sessionStorage.getItem("openrouter_post_connect"), []);

  const errorReturnPath = callbackTarget === "settings"
    ? "/app/settings"
    : callbackTarget === "return"
      ? "/openrouter-required"
      : "/onboarding";

  const errorReturnLabel = callbackTarget === "settings"
    ? t("openrouter_back_to_settings")
    : callbackTarget === "return"
      ? t("openrouter_back_to_reconnect")
      : t("openrouter_back_to_onboarding");
  const showSettingsFallback = errorReturnPath !== "/app/settings";

  useEffect(() => {
    if (status !== "loading" || isAuthLoading) {
      setAuthDelayMessage("");
      return;
    }
    if (isAuthenticated) {
      setAuthDelayMessage("");
      return;
    }
    const timer = window.setTimeout(() => {
      if (didRun.current) return;
      setAuthDelayMessage("Authentication is taking longer than expected. We’ll keep trying automatically.");
    }, AUTH_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isAuthLoading, isAuthenticated, status]);

  useEffect(() => {
    // Wait until Convex is authenticated before exchanging the code.
    // ConvexProviderWithClerk may still be syncing the Clerk session token.
    if (isAuthLoading || !isAuthenticated || status !== "loading") return;
    if (didRun.current) return;
    didRun.current = true;

    async function handleCallback() {
      const code = searchParams.get("code");
      const stateParam = searchParams.get("state");

      if (!code || !stateParam) {
        setErrorMessage(t("openrouter_err_missing_code"));
        setStatus("error");
        return;
      }

      const storedState = sessionStorage.getItem("pkce_state");
      const storedVerifier = sessionStorage.getItem("pkce_verifier");

      if (!storedState || storedState !== stateParam) {
        setErrorMessage(t("openrouter_err_state_mismatch"));
        setStatus("error");
        return;
      }

      if (!storedVerifier) {
        setErrorMessage(t("openrouter_err_pkce_missing"));
        setStatus("error");
        return;
      }

      try {
        const apiKey = await exchangeCodeForKey(code, storedVerifier);
        const postConnectTarget = sessionStorage.getItem("openrouter_post_connect");
        const postConnectPath = sessionStorage.getItem("openrouter_post_connect_path");

        // Clean up sessionStorage
        sessionStorage.removeItem("pkce_state");
        sessionStorage.removeItem("pkce_verifier");
        sessionStorage.removeItem("openrouter_post_connect");
        sessionStorage.removeItem("openrouter_post_connect_path");

        // Store the API key to Convex (server-side, encrypted at rest)
        await upsertApiKey({ apiKey });

        if (postConnectTarget === "onboarding") {
          await setOnboardingCompleted({});
        }

        setStatus("success");

        const nextPath = postConnectTarget === "onboarding"
          ? "/app/chat"
          : postConnectTarget === "settings"
            ? "/app/settings"
            : postConnectPath && postConnectPath.startsWith("/app")
              ? postConnectPath
              : "/app/chat";

        // Navigate after a short delay so user sees the success state
        setTimeout(
          () => navigate(nextPath, { replace: true }),
          1500,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : t("openrouter_err_unknown");
        setErrorMessage(message);
        setStatus("error");
      }
    }

    void handleCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthLoading, isAuthenticated, navigate, searchParams, status, t, upsertApiKey]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm text-center space-y-4">
        {status === "loading" && (
          <>
            <LoadingSpinner size="lg" className="mx-auto" />
            <p className="text-foreground/60 text-sm">
              {t("openrouter_connecting")}
            </p>
            {authDelayMessage ? (
              <p className="text-foreground/50 text-xs">
                {authDelayMessage}
              </p>
            ) : null}
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-12 h-12 rounded-full bg-success/15 flex items-center justify-center mx-auto">
              <span className="text-success text-2xl">✓</span>
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              {t("openrouter_connected_title")}
            </h2>
            <p className="text-foreground/55 text-sm">
              {t("openrouter_connected_desc")}
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-12 h-12 rounded-full bg-destructive/12 flex items-center justify-center mx-auto">
              <span className="text-destructive text-2xl">✕</span>
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              {t("openrouter_connection_failed")}
            </h2>
            <p className="text-foreground/55 text-sm">
              {errorMessage}
            </p>
            <div className="mt-2 flex flex-col gap-2">
              <button
                onClick={() => navigate(errorReturnPath, { replace: true })}
                className="px-4 py-2 rounded-lg border border-border text-sm text-secondary hover:text-foreground transition-colors"
              >
                {errorReturnLabel}
              </button>
              {showSettingsFallback ? (
                <button
                  onClick={() => navigate("/app/settings", { replace: true })}
                  className="px-4 py-2 rounded-lg border border-border text-sm text-secondary hover:text-foreground transition-colors"
                >
                  {t("openrouter_back_to_settings")}
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
