import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { useOpenRouterStatus, useSharedData } from "@/hooks/useSharedData";
import { generatePKCE } from "@/lib/pkce";
import { OpenRouter } from "@/lib/constants";

// MARK: - Screen definitions

interface OnboardingScreen {
  id: number;
  title: string;
  subtitle: string;
  body: string;
  action?: "connect-openrouter";
}

// MARK: - Component

export function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const hasApiKey = useOpenRouterStatus();
  const { prefs } = useSharedData();
  const [current, setCurrent] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isReplayMode = searchParams.get("mode") === "replay";

  const SCREENS: OnboardingScreen[] = [
    { id: 0, title: t("onboarding_screen1_title"), subtitle: t("onboarding_screen1_subtitle"), body: t("onboarding_screen1_body") },
    { id: 1, title: t("onboarding_screen2_title"), subtitle: t("onboarding_screen2_subtitle"), body: t("onboarding_screen2_body") },
    { id: 2, title: t("onboarding_screen3_title"), subtitle: t("onboarding_screen3_subtitle"), body: t("onboarding_screen3_body") },
    { id: 3, title: t("onboarding_screen4_title"), subtitle: t("onboarding_screen4_subtitle"), body: t("onboarding_screen4_body") },
    { id: 4, title: t("onboarding_screen5_title"), subtitle: t("onboarding_screen5_subtitle"), body: t("onboarding_screen5_body") },
    { id: 5, title: t("onboarding_screen6_title"), subtitle: t("onboarding_screen6_subtitle"), body: t("onboarding_screen6_body"), action: "connect-openrouter" },
  ];

  const setOnboardingCompleted = useMutation(
    api.preferences.mutations.setOnboardingCompleted,
  );

  const screen = SCREENS[current];
  const isFirst = current === 0;
  const isLast = current === SCREENS.length - 1;
  const canFinish = hasApiKey === true;
  const isCheckingConnection = hasApiKey === undefined;
  const showConnectPrompt = !canFinish;
  const finalHint = isReplayMode
    ? canFinish
      ? t("openrouter_already_connected_replay")
      : t("openrouter_optional_reconnect_replay")
    : canFinish
      ? t("openrouter_connected_title")
      : t("continue_with_a_supported_provider_to_finish_onboarding");
  const finalButtonLabel = isReplayMode ? t("done") : t("finish");

  useEffect(() => {
    if (!isReplayMode && prefs?.onboardingCompleted) {
      navigate("/openrouter-required", { replace: true });
    }
  }, [isReplayMode, navigate, prefs?.onboardingCompleted]);

  function handleBack() {
    if (!isFirst) setCurrent((c) => c - 1);
  }

  function handleNext() {
    if (!isLast) setCurrent((c) => c + 1);
  }

  async function handleConnect() {
    setErrorMessage(null);
    try {
      const { state, verifier, challenge } = await generatePKCE();
      sessionStorage.setItem("pkce_state", state);
      sessionStorage.setItem("pkce_verifier", verifier);
      sessionStorage.setItem("openrouter_post_connect", isReplayMode ? "return" : "onboarding");
      if (isReplayMode) {
        sessionStorage.setItem("openrouter_post_connect_path", "/app/settings");
      } else {
        sessionStorage.removeItem("openrouter_post_connect_path");
      }
      const params = new URLSearchParams({
        callback_url: OpenRouter.callbackUrl,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
      });
      window.location.href = `${OpenRouter.oauthUrl}?${params.toString()}`;
    } catch (err) {
      setErrorMessage(
        err instanceof Error && err.message.trim().length > 0
          ? err.message
          : t("something_went_wrong"),
      );
    }
  }

  async function handleFinish() {
    if (!canFinish) {
      setErrorMessage(t("continue_with_a_supported_provider_to_finish_onboarding"));
      return;
    }

    setFinishing(true);
    setErrorMessage(null);
    try {
      await setOnboardingCompleted({});
      navigate(isReplayMode ? "/app/settings" : "/app/chat", { replace: true });
    } catch (err) {
      setErrorMessage(
        err instanceof Error && err.message.trim().length > 0
          ? err.message
          : t("something_went_wrong"),
      );
      setFinishing(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6">
      {/* Card */}
      <div className="w-full max-w-md">
        {/* Slide content */}
        <div
          key={current}
          className="animate-fade-in text-center mb-10"
        >
          <p className="text-xs font-semibold tracking-widest uppercase text-primary/70 mb-3">
            {screen.subtitle}
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-4 nanth-display">
            {screen.title}
          </h1>
          <p className="text-foreground/60 leading-relaxed text-base">
            {screen.body}
          </p>

          {/* Connect button on last screen */}
          {screen.action === "connect-openrouter" && (
            <div className="mt-6 space-y-3">
              {showConnectPrompt ? (
                <button
                  onClick={handleConnect}
                  className="px-5 py-2.5 rounded-lg border border-primary/40 bg-primary/10 text-primary text-sm font-medium hover:bg-primary/18 transition-colors"
                >
                  {t("connect_openrouter")}
                </button>
              ) : null}
              <p className="text-sm text-foreground/50">
                {finalHint}
              </p>
            </div>
          )}
        </div>

        {/* Dot indicators */}
        <div className="flex justify-center gap-1.5 mb-8">
          {SCREENS.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              aria-label={`Go to screen ${i + 1}`}
              className={[
                "rounded-full transition-all duration-200",
                i === current
                  ? "w-4 h-2 bg-primary"
                  : "w-2 h-2 bg-border hover:bg-foreground/30",
              ].join(" ")}
            />
          ))}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center gap-3">
          {!isFirst && (
            <button
              onClick={handleBack}
              className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium text-secondary hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              {t("back")}
            </button>
          )}
          {isLast ? (
            <button
              onClick={handleFinish}
              disabled={finishing || isCheckingConnection || !canFinish}
              className="flex-1 py-2.5 rounded-lg bg-primary text-background text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {finishing ? <LoadingSpinner size="sm" /> : null}
              {finalButtonLabel}
            </button>
          ) : (
            <button
              onClick={handleNext}
              className="flex-1 py-2.5 rounded-lg bg-primary text-background text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              {t("next")}
            </button>
          )}
        </div>

        {errorMessage && (
          <p className="mt-4 text-sm text-red-400 text-center">{errorMessage}</p>
        )}
      </div>
    </div>
  );
}
