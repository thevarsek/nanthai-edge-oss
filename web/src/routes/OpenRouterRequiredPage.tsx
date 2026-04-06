import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useClerk } from "@clerk/clerk-react";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { useOpenRouterStatus, useSharedData } from "@/hooks/useSharedData";
import { OpenRouter } from "@/lib/constants";
import { generatePKCE } from "@/lib/pkce";

type RedirectState = {
  from?: {
    pathname: string;
    search: string;
    hash: string;
  };
};

export function OpenRouterRequiredPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useClerk();
  const { prefs } = useSharedData();
  const hasApiKey = useOpenRouterStatus();
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const returnPath = useMemo(() => {
    const from = (location.state as RedirectState | null)?.from;
    if (!from || !from.pathname.startsWith("/app")) return "/app/chat";
    return `${from.pathname}${from.search}${from.hash}`;
  }, [location.state]);

  useEffect(() => {
    if (prefs === undefined || prefs === null || hasApiKey === undefined) {
      return;
    }
    if (!prefs.onboardingCompleted) {
      navigate("/onboarding", { replace: true });
      return;
    }
    if (hasApiKey === true) {
      navigate(returnPath, { replace: true });
    }
  }, [hasApiKey, navigate, prefs, returnPath]);

  async function handleConnect() {
    setIsConnecting(true);
    setErrorMessage(null);
    try {
      const { state, verifier, challenge } = await generatePKCE();
      sessionStorage.setItem("pkce_state", state);
      sessionStorage.setItem("pkce_verifier", verifier);
      sessionStorage.setItem("openrouter_post_connect", "return");
      sessionStorage.setItem("openrouter_post_connect_path", returnPath);
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
      setIsConnecting(false);
    }
  }

  if (prefs === undefined || prefs === null || hasApiKey === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-3xl border border-border/50 bg-surface-2 p-8 text-center shadow-xl shadow-black/10 space-y-4">
        <p className="text-xs font-semibold tracking-[0.18em] uppercase text-primary/70">
          {t("openrouter_section_header")}
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground nanth-display">
          {t("openrouter_required_title")}
        </h1>
        <p className="text-sm leading-relaxed text-foreground/60">
          {t("openrouter_required_body")}
        </p>
        <div className="space-y-3">
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {isConnecting ? t("connecting") : t("connect_openrouter")}
          </button>
          <button
            onClick={() => navigate("/", { replace: true })}
            className="w-full py-3 rounded-xl border border-border text-sm font-medium text-secondary hover:text-foreground transition-colors"
          >
            {t("back_to_introduction")}
          </button>
          <button
            onClick={() => void signOut(() => navigate("/", { replace: true }))}
            className="w-full py-3 rounded-xl border border-border text-sm font-medium text-secondary hover:text-foreground transition-colors"
          >
            {t("sign_out")}
          </button>
          <a
            href="mailto:support@nanthai.tech"
            className="block w-full py-3 rounded-xl border border-border text-sm font-medium text-secondary hover:text-foreground transition-colors"
          >
            {t("contact_support")}
          </a>
        </div>
        <p className="text-xs text-foreground/45 leading-relaxed">
          {t("openrouter_required_return_hint")}
        </p>
        {errorMessage ? (
          <p className="text-sm text-red-400">{errorMessage}</p>
        ) : null}
      </div>
    </div>
  );
}
