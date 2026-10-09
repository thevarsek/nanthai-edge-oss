import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { OpenRouter } from "@/lib/constants";
import { generatePKCE } from "@/lib/pkce";
import { analyticsErrorLabel, captureAnalytics } from "@/lib/analytics";

/** Shared PKCE entry for settings and chat recovery. Never revokes the existing key. */
export function useOpenRouterConnect(returnPath = "/app/settings", source = "settings") {
  const { t } = useTranslation();
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const connect = useCallback(async () => {
    setIsConnecting(true);
    setErrorMessage(null);
    captureAnalytics("openrouter_connect_started", { feature_area: "settings", source });
    try {
      const { state, verifier, challenge } = await generatePKCE();
      sessionStorage.setItem("pkce_state", state);
      sessionStorage.setItem("pkce_verifier", verifier);
      sessionStorage.setItem("openrouter_post_connect", source === "settings" ? "settings" : "return");
      sessionStorage.setItem("openrouter_post_connect_path", returnPath);
      sessionStorage.setItem("openrouter_post_connect_source", source);
      const params = new URLSearchParams({ callback_url: OpenRouter.callbackUrl, code_challenge: challenge, code_challenge_method: "S256", state });
      window.location.href = `${OpenRouter.oauthUrl}?${params.toString()}`;
    } catch (error) {
      captureAnalytics("openrouter_connect_failed", { feature_area: "settings", source, failure_stage: "start", error_label: analyticsErrorLabel(error) });
      setErrorMessage(error instanceof Error && error.message.trim() ? error.message : t("something_went_wrong"));
      setIsConnecting(false);
    }
  }, [returnPath, source, t]);
  return { isConnecting, errorMessage, connect };
}
