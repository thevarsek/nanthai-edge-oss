import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { CheckCircle2, XCircle, Link2, MinusCircle, RefreshCw, ExternalLink } from "lucide-react";
import { useOpenRouterStatus, useCreditBalance, useSharedData, formatUsd, balanceTierOf } from "@/hooks/useSharedData";
import { OpenRouter } from "@/lib/constants";
import { generatePKCE } from "@/lib/pkce";

// ─── Helpers ───────────────────────────────────────────────────────────────

function creditColorClass(balance: number): string {
  const tier = balanceTierOf(balance);
  if (tier === "green") return "text-green-400";
  if (tier === "amber") return "text-amber-400";
  return "text-red-400";
}

// ─── Component ─────────────────────────────────────────────────────────────

/**
 * OpenRouter connection section — reads connection status from Convex
 * (hasApiKey query), fetches credit balance from shared useCreditBalance hook,
 * and uses Convex mutations for connect/disconnect.
 */
export function OpenRouterSection() {
  const { t } = useTranslation();
  const hasApiKey = useOpenRouterStatus();
  const deleteApiKey = useMutation(api.scheduledJobs.mutations.deleteApiKey);
  const { balance, loading: creditLoading, refresh: refreshCredits } = useCreditBalance();
  const { prefs } = useSharedData();
  const upsertPreferences = useMutation(api.preferences.mutations.upsertPreferences);
  const typedPrefs = prefs as { showBalanceInChat?: boolean; showAdvancedStats?: boolean } | undefined;
  const showBalanceInChat = typedPrefs?.showBalanceInChat === true; // defaults false
  const showAdvancedStats = typedPrefs?.showAdvancedStats === true; // defaults false

  const [isConnecting, setIsConnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Derive connected status from Convex (undefined = loading, true/false = known)
  const connected = hasApiKey === true;
  const isLoading = hasApiKey === undefined;

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    setErrorMessage(null);
    try {
      const { state, verifier, challenge } = await generatePKCE();
      sessionStorage.setItem("pkce_state", state);
      sessionStorage.setItem("pkce_verifier", verifier);
      sessionStorage.setItem("openrouter_post_connect", "settings");
      sessionStorage.setItem("openrouter_post_connect_path", "/app/settings");
      const params = new URLSearchParams({
        callback_url: OpenRouter.callbackUrl,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
      });
      window.location.href = `${OpenRouter.oauthUrl}?${params.toString()}`;
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t("something_went_wrong"),
      );
      setIsConnecting(false);
    }
  }, [t]);

  const handleDisconnect = useCallback(async () => {
    setErrorMessage(null);
    try {
      await deleteApiKey({});
      setShowDisconnectConfirm(false);
    } catch (err) {
      setErrorMessage(
        err instanceof Error && err.message.trim().length > 0
          ? err.message
          : t("something_went_wrong"),
      );
    }
  }, [deleteApiKey, t]);

  return (
    <div className="space-y-2">
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        {/* Status row */}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm">{t("status")}</span>
          <div className="flex items-center gap-1.5">
            {isLoading ? (
              <span className="text-sm text-muted">{t("checking")}</span>
            ) : connected ? (
              <>
                <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />
                <span className="text-sm text-green-400">{t("connected")}</span>
              </>
            ) : (
              <>
                <XCircle size={16} className="text-muted flex-shrink-0" />
                <span className="text-sm text-muted">{t("not_connected")}</span>
              </>
            )}
          </div>
        </div>

        {connected ? (
          <>
            {/* Credits row — shows balance with color coding */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm">{t("credits")}</span>
              <div className="flex items-center gap-2">
                {creditLoading && balance === null ? (
                  <span className="text-sm text-muted">{t("loading")}</span>
                ) : balance !== null ? (
                  <span className={`text-sm font-medium ${creditColorClass(balance)}`}>
                    {formatUsd(balance)}
                  </span>
                ) : (
                  <span className="text-sm text-muted">{t("unavailable")}</span>
                )}
                <button
                  onClick={() => void refreshCredits()}
                  className="p-1 rounded hover:bg-surface-3 transition-colors"
                  title={t("refresh_credits")}
                >
                  <RefreshCw size={14} className={`text-muted ${creditLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* View on OpenRouter */}
            <a
              href="https://openrouter.ai/settings/credits"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-4 py-3 hover:bg-surface-3 transition-colors"
            >
              <span className="text-sm">{t("manage_credits")}</span>
              <ExternalLink size={14} className="text-muted" />
            </a>

            {/* Show Balance in Chat toggle */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex flex-col">
                <span className="text-sm">{t("show_balance_in_chat")}</span>
                <span className="text-xs text-muted">{t("show_balance_in_chat_description")}</span>
              </div>
              <button
                role="switch"
                aria-checked={showBalanceInChat}
                onClick={() => void upsertPreferences({ showBalanceInChat: !showBalanceInChat })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showBalanceInChat ? "bg-accent" : "bg-surface-3"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${showBalanceInChat ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>

            {/* Show Advanced Stats toggle */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex flex-col">
                <span className="text-sm">{t("show_advanced_stats")}</span>
                <span className="text-xs text-muted">{t("display_cost_per_message")}</span>
              </div>
              <button
                role="switch"
                aria-checked={showAdvancedStats}
                onClick={() => void upsertPreferences({ showAdvancedStats: !showAdvancedStats })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showAdvancedStats ? "bg-accent" : "bg-surface-3"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${showAdvancedStats ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>

            {/* Disconnect */}
            <button
              onClick={() => setShowDisconnectConfirm(true)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
            >
              <MinusCircle size={16} className="text-red-400 flex-shrink-0" />
              <span className="text-sm text-red-400">{t("disconnect_openrouter")}</span>
            </button>
          </>
        ) : (
          /* Connect */
          <button
            onClick={handleConnect}
            disabled={isConnecting || isLoading}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left disabled:opacity-50"
          >
            <Link2 size={16} className="text-accent flex-shrink-0" />
            <span className="text-sm text-accent">
              {isConnecting ? t("connecting") : t("connect_openrouter")}
            </span>
          </button>
        )}
      </div>

      {errorMessage && (
        <p className="text-sm text-red-400 px-1">{errorMessage}</p>
      )}

      {/* Disconnect confirm modal */}
      {showDisconnectConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm bg-surface-1 rounded-2xl p-6 space-y-4 shadow-xl">
            <h2 className="text-base font-semibold">{t("disconnect_openrouter_confirm_title")}</h2>
            <p className="text-sm text-muted">
              {t("your_api_key_will_be_removed")}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDisconnectConfirm(false)}
                className="flex-1 py-2 rounded-lg bg-surface-2 text-sm hover:bg-surface-3 transition-colors"
              >
                {t("cancel")}
              </button>
              <button
                onClick={() => void handleDisconnect()}
                className="flex-1 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
              >
                {t("disconnect")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
