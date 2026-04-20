import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { useConnectedAccounts } from "@/hooks/useSharedData";
import { IntegrationLogo } from "@/components/shared/IntegrationLogo";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { convexErrorMessage } from "@/lib/convexErrors";
import {
  buildProviderAuthorizationUrl,
  clearOAuthContext,
  getOAuthClientId,
  type OAuthPopupMessage,
  type OAuthProvider,
} from "@/lib/providerOAuth";

// ─── Helpers ───────────────────────────────────────────────────────────────

function ConnectionRow({
  label,
  description,
  icon,
  isConnected,
  onConnect,
  onDisconnect,
  disabled,
  disconnectedBadgeLabel,
}: {
  label: string;
  description: string;
  icon: ReactNode;
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  disabled?: boolean;
  disconnectedBadgeLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-10 h-10 rounded-xl bg-surface-3 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted mt-0.5">{description}</p>
      </div>
      {isConnected ? (
        <button
          onClick={onDisconnect}
          disabled={disabled}
          className="px-3 py-1.5 rounded-lg bg-surface-3 text-sm text-muted hover:text-red-400 transition-colors disabled:opacity-50"
        >
          {t("disconnect")}
        </button>
      ) : disconnectedBadgeLabel ? (
        <span className="inline-flex items-center rounded-full bg-amber-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-amber-300">
          {disconnectedBadgeLabel}
        </span>
      ) : (
        <button
          onClick={onConnect}
          disabled={disabled}
          className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {t("connect")}
        </button>
      )}
    </div>
  );
}

// ─── Apple Calendar Modal ──────────────────────────────────────────────────

function AppleCalendarModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectAppleCalendar = useAction(api.oauth.apple_calendar.connectAppleCalendar);

  const handleConnect = async () => {
    if (!email || !password) return;
    setLoading(true);
    setError(null);
    try {
      await connectAppleCalendar({ appleId: email, appSpecificPassword: password });
      onClose();
    } catch (connectionError) {
      setError(convexErrorMessage(connectionError, t("connection_failed")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm bg-surface-1 rounded-2xl p-6 space-y-4 shadow-xl">
        <h2 className="text-lg font-semibold">{t("connect_apple_calendar")}</h2>
        <p className="text-sm text-muted">
          {t("apple_id_email_instructions")}
        </p>
        <div className="space-y-3">
          <input
            type="email"
            placeholder={t("apple_account_email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-surface-2 text-sm border border-border/50 focus:outline-none focus:border-accent"
          />
          <input
            type="password"
            placeholder={t("app_specific_password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-surface-2 text-sm border border-border/50 focus:outline-none focus:border-accent"
          />
        </div>
        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg bg-surface-2 text-sm hover:bg-surface-3 transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            onClick={handleConnect}
            disabled={loading || !email || !password}
            className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {loading ? t("connecting") : t("connect")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Cloze API Key Modal ───────────────────────────────────────────────────

function ClozeModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectCloze = useAction(api.oauth.cloze.connectCloze);

  const handleConnect = async () => {
    if (!apiKey) return;
    setLoading(true);
    setError(null);
    try {
      await connectCloze({ apiKey, label: label || undefined });
      onClose();
    } catch (connectionError) {
      setError(convexErrorMessage(connectionError, t("connection_failed")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm bg-surface-1 rounded-2xl p-6 space-y-4 shadow-xl">
        <h2 className="text-lg font-semibold">{t("connect_cloze")}</h2>
        <div className="text-sm text-muted space-y-2">
          <p>{t("cloze_api_key_instructions")}</p>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li>{t("cloze_step_1")}</li>
            <li>{t("cloze_step_2")}</li>
            <li>{t("cloze_step_3")}</li>
          </ol>
          <a
            href="https://help.cloze.com/article/2176-api-key"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent text-xs hover:underline"
          >
            {t("cloze_help_link")}
          </a>
        </div>
        <div className="space-y-3">
          <input
            type="password"
            placeholder={t("cloze_api_key_placeholder")}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-surface-2 text-sm border border-border/50 focus:outline-none focus:border-accent"
          />
          <input
            type="text"
            placeholder={t("cloze_label_placeholder")}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-surface-2 text-sm border border-border/50 focus:outline-none focus:border-accent"
          />
        </div>
        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg bg-surface-2 text-sm hover:bg-surface-3 transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            onClick={handleConnect}
            disabled={loading || !apiKey}
            className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {loading ? t("connecting") : t("connect")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export function ConnectedAccountsSection() {
  const { t } = useTranslation();
  const { googleConnection, microsoftConnection, notionConnection, slackConnection, appleCalendarConnection, clozeConnection } =
    useConnectedAccounts();
  const [showAppleModal, setShowAppleModal] = useState(false);
  const [showClozeModal, setShowClozeModal] = useState(false);
  const [showGoogleDisconnectConfirm, setShowGoogleDisconnectConfirm] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  const disconnectGoogle = useAction(api.oauth.google.disconnectGoogle);
  const disconnectMicrosoft = useAction(api.oauth.microsoft.disconnectMicrosoft);
  const disconnectNotion = useAction(api.oauth.notion.disconnectNotion);
  const disconnectSlack = useAction(api.oauth.slack.disconnectSlack);
  const disconnectAppleCalendar = useAction(api.oauth.apple_calendar.disconnectAppleCalendar);
  const disconnectCloze = useAction(api.oauth.cloze.disconnectCloze);

  useEffect(() => {
    function handleMessage(event: MessageEvent<OAuthPopupMessage>) {
      if (event.origin !== window.location.origin) return;
      const message = event.data;
      if (!message || message.type !== "nanthai-oauth-result") return;
      popupRef.current?.close();
      popupRef.current = null;
      setPendingProvider(null);
      setProviderError(message.success ? null : message.error ?? t("connection_failed"));
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [t]);

  useEffect(() => {
    if (!pendingProvider) return;

    const timer = window.setInterval(() => {
      if (popupRef.current && popupRef.current.closed) {
        popupRef.current = null;
        setPendingProvider((current) => {
          if (current == null) return current;
          setProviderError((existing) => existing ?? t("sign_in_cancelled_arg", { var1: labelForProvider(current) }));
          return null;
        });
      }
    }, 400);

    return () => window.clearInterval(timer);
  }, [pendingProvider, t]);

  const openOAuthPopup = async (provider: OAuthProvider) => {
    setProviderError(null);

    if (!getOAuthClientId(provider)) {
      setProviderError(t("oauth_not_configured_arg", { var1: labelForProvider(provider) }));
      return;
    }

    try {
      const url = await buildProviderAuthorizationUrl(
        provider,
        provider === "google" ? { requestedIntegration: "base" } : undefined,
      );
      const popup = window.open(url, "oauth-popup", "width=600,height=700,menubar=no,toolbar=no");
      if (!popup) {
        clearOAuthContext(provider);
        setProviderError(t("popup_blocked_error_arg", { var1: labelForProvider(provider) }));
        return;
      }
      popupRef.current = popup;
      setPendingProvider(provider);
    } catch (error) {
      clearOAuthContext(provider);
      setProviderError(convexErrorMessage(error, t("sign_in_cancelled_arg", { var1: labelForProvider(provider) })));
    }
  };

  const isBusy = (provider: OAuthProvider) => pendingProvider === provider;
  const isActionBusy = (action: string) => busyAction === action;
  const runAccountAction = async (action: string, fn: () => Promise<unknown>) => {
    setProviderError(null);
    setBusyAction(action);
    try {
      await fn();
      return true;
    } catch (error) {
      setProviderError(convexErrorMessage(error, t("connection_failed")));
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted px-1">
        {t("connect_external_services")}
      </p>

      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        <ConnectionRow
          label="Google Workspace"
          description={t("google_workspace_description")}
          icon={<IntegrationLogo slug="google-workspace" size={32} />}
          isConnected={!!googleConnection}
          onConnect={() => void openOAuthPopup("google")}
          onDisconnect={() => setShowGoogleDisconnectConfirm(true)}
          disabled={isBusy("google") || isActionBusy("disconnect-google")}
          disconnectedBadgeLabel="Coming Soon"
        />
        <ConnectionRow
          label="Microsoft 365"
          description={t("microsoft_365_description")}
          icon={<IntegrationLogo slug="microsoft-365" size={32} />}
          isConnected={!!microsoftConnection}
          onConnect={() => void openOAuthPopup("microsoft")}
          onDisconnect={() => { void runAccountAction("disconnect-microsoft", () => disconnectMicrosoft({})); }}
          disabled={isBusy("microsoft") || isActionBusy("disconnect-microsoft")}
        />
        <ConnectionRow
          label="Notion"
          description={t("notion_description")}
          icon={<IntegrationLogo slug="notion" size={32} />}
          isConnected={!!notionConnection}
          onConnect={() => void openOAuthPopup("notion")}
          onDisconnect={() => { void runAccountAction("disconnect-notion", () => disconnectNotion({})); }}
          disabled={isBusy("notion") || isActionBusy("disconnect-notion")}
        />
        <ConnectionRow
          label={t("integration_slack")}
          description={t("slack_description")}
          icon={<IntegrationLogo slug="slack" size={32} />}
          isConnected={!!slackConnection}
          onConnect={() => void openOAuthPopup("slack")}
          onDisconnect={() => { void runAccountAction("disconnect-slack", () => disconnectSlack({})); }}
          disabled={isBusy("slack") || isActionBusy("disconnect-slack")}
        />
        <ConnectionRow
          label="Apple Calendar"
          description={t("apple_calendar_description")}
          icon={<IntegrationLogo slug="apple-calendar" size={32} />}
          isConnected={!!appleCalendarConnection}
          onConnect={() => setShowAppleModal(true)}
          onDisconnect={() => { void runAccountAction("disconnect-apple-calendar", () => disconnectAppleCalendar({})); }}
          disabled={pendingProvider !== null || isActionBusy("disconnect-apple-calendar")}
        />
        <ConnectionRow
          label="Cloze CRM"
          description={t("cloze_description")}
          icon={<IntegrationLogo slug="cloze" size={32} />}
          isConnected={clozeConnection?.status === "active"}
          onConnect={() => setShowClozeModal(true)}
          onDisconnect={() => { void runAccountAction("disconnect-cloze", () => disconnectCloze({})); }}
          disabled={pendingProvider !== null || isActionBusy("disconnect-cloze")}
        />
      </div>

      {providerError && (
        <p className="text-sm text-red-400 px-1">{providerError}</p>
      )}

      <ConfirmDialog
        isOpen={showGoogleDisconnectConfirm}
        onClose={() => setShowGoogleDisconnectConfirm(false)}
        onConfirm={() => {
          void (async () => {
            const didDisconnect = await runAccountAction("disconnect-google", () => disconnectGoogle({}));
            if (didDisconnect) {
              setShowGoogleDisconnectConfirm(false);
            }
          })();
        }}
        title="Disconnect Google?"
        description="Your Google tokens will be revoked. Gmail, Drive, and Calendar tools will stop working, and reconnect is temporarily unavailable while Google scope approval is pending."
        confirmLabel={t("disconnect")}
      />

      {showAppleModal && (
        <AppleCalendarModal onClose={() => setShowAppleModal(false)} />
      )}

      {showClozeModal && (
        <ClozeModal onClose={() => setShowClozeModal(false)} />
      )}
    </div>
  );
}

function labelForProvider(provider: OAuthProvider): string {
  const labels: Record<OAuthProvider, string> = {
    google: "Google",
    microsoft: "Microsoft",
    notion: "Notion",
    slack: "Slack",
  };
  return labels[provider];
}
