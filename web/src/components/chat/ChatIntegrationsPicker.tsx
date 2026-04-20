// components/chat/ChatIntegrationsPicker.tsx
// Modal picker for per-chat integration toggles.
// Mirrors iOS ChatIntegrationsPickerSheet — grouped by provider,
// only shows integrations the user has connected.

import { useTranslation } from "react-i18next";
import { X, PuzzleIcon } from "lucide-react";
import { Toggle } from "@/components/shared/Toggle";
import { IntegrationLogo } from "@/components/shared/IntegrationLogo";
import type { IntegrationKey } from "@/routes/PersonaEditorForm";

// ─── Integration metadata ───────────────────────────────────────────────────

interface IntegrationMeta {
  key: IntegrationKey;
  label: string;
  subtitle: string;
  logoSlug: string;
  provider: "google" | "microsoft" | "apple" | "notion" | "cloze" | "slack";
}

function buildIntegrations(t: ReturnType<typeof useTranslation>["t"]): IntegrationMeta[] {
  return [
    { key: "gmail", label: "Gmail", subtitle: t("integration_gmail_subtitle"), logoSlug: "gmail", provider: "google" },
    { key: "drive", label: "Google Drive", subtitle: t("integration_google_drive_subtitle"), logoSlug: "google-drive", provider: "google" },
    { key: "calendar", label: "Google Calendar", subtitle: t("integration_google_calendar_subtitle"), logoSlug: "google-calendar", provider: "google" },
    { key: "outlook", label: "Outlook Mail", subtitle: t("integration_outlook_subtitle"), logoSlug: "outlook", provider: "microsoft" },
    { key: "onedrive", label: "OneDrive", subtitle: t("integration_onedrive_subtitle"), logoSlug: "onedrive", provider: "microsoft" },
    { key: "ms_calendar", label: "MS Calendar", subtitle: t("integration_ms_calendar_subtitle"), logoSlug: "ms-calendar", provider: "microsoft" },
    { key: "apple_calendar", label: "Apple Calendar", subtitle: t("integration_apple_calendar_subtitle"), logoSlug: "apple-calendar", provider: "apple" },
    { key: "notion", label: "Notion", subtitle: t("integration_notion_subtitle"), logoSlug: "notion", provider: "notion" },
    { key: "cloze", label: "Cloze CRM", subtitle: t("integration_cloze_subtitle"), logoSlug: "cloze", provider: "cloze" },
    { key: "slack", label: t("integration_slack"), subtitle: t("integration_slack_subtitle"), logoSlug: "slack", provider: "slack" },
  ];
}

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google Workspace",
  microsoft: "Microsoft 365",
  apple: "Apple",
  notion: "Notion",
  cloze: "Cloze",
  slack: "Slack",
};

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  enabledIntegrations: Set<IntegrationKey>;
  onToggle: (key: IntegrationKey) => void;
  onClose: () => void;
  /** Which providers the user has connected (from SharedData) */
  connectedProviders: {
    google: boolean;
    microsoft: boolean;
    apple: boolean;
    notion: boolean;
    cloze: boolean;
    slack: boolean;
  };
  /** When true, Google integration toggles are disabled because chat models are incompatible. */
  googleIntegrationsBlocked?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ChatIntegrationsPicker({
  enabledIntegrations,
  onToggle,
  onClose,
  connectedProviders,
  googleIntegrationsBlocked,
}: Props) {
  const { t } = useTranslation();
  const ALL_INTEGRATIONS = buildIntegrations(t);
  // Filter to only connected integrations
  const available = ALL_INTEGRATIONS.filter(
    (i) => connectedProviders[i.provider],
  );

  // Group by provider
  const grouped = available.reduce(
    (acc, i) => {
      if (!acc[i.provider]) acc[i.provider] = [];
      acc[i.provider].push(i);
      return acc;
    },
    {} as Record<string, IntegrationMeta[]>,
  );

  const providerOrder = ["google", "microsoft", "apple", "notion", "cloze", "slack"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md bg-surface-1 rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{ maxHeight: "80vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <PuzzleIcon size={18} className="text-primary" />
            <h2 className="text-base font-semibold">{t("integrations")}</h2>
            {enabledIntegrations.size > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                {enabledIntegrations.size}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-3 text-muted hover:text-foreground transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: "calc(80vh - 4rem)" }}>
          {available.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <PuzzleIcon size={32} className="text-muted mx-auto mb-3 opacity-40" />
              <p className="text-sm text-muted">{t("no_integrations_connected")}</p>
              <p className="text-xs text-muted mt-1">
                {t("connect_integrations_in_settings")}
              </p>
            </div>
          ) : (
            providerOrder
              .filter((p) => grouped[p]?.length)
              .map((provider) => (
                <div key={provider}>
                  <div className="px-5 pt-4 pb-1">
                    <h3 className="text-xs font-medium text-muted uppercase tracking-wide">
                      {PROVIDER_LABELS[provider] ?? provider}
                    </h3>
                  </div>
                  <div className="divide-y divide-border/30">
                    {grouped[provider].map((integration) => {
                      const isGoogleBlocked = googleIntegrationsBlocked === true && integration.provider === "google" && !enabledIntegrations.has(integration.key);
                      return (
                        <div key={integration.key}>
                          <div
                            className={`flex items-center gap-3 px-5 py-3 transition-colors ${isGoogleBlocked ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-2 cursor-pointer"}`}
                            onClick={() => !isGoogleBlocked && onToggle(integration.key)}
                          >
                            <IntegrationLogo slug={integration.logoSlug} size={28} className="flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm">{integration.label}</p>
                              <p className="text-xs text-muted">{integration.subtitle}</p>
                            </div>
                            <div onClick={(event) => event.stopPropagation()}>
                              <Toggle
                                checked={enabledIntegrations.has(integration.key)}
                                onChange={() => !isGoogleBlocked && onToggle(integration.key)}
                                size="small"
                                disabled={isGoogleBlocked}
                              />
                            </div>
                          </div>
                          {isGoogleBlocked && (
                            <p className="px-5 pb-2 -mt-1 text-[10px] text-muted">{t("google_integration_blocked_by_model")}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}
