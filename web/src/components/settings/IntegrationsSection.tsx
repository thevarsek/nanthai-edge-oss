import { Puzzle, ChevronRight, Mail } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useTranslation } from "react-i18next";
import { ProGateWrapper } from "@/hooks/useProGate";
import { ConnectedAccountsSection } from "@/components/settings/ConnectedAccountsSection";
import { convexErrorMessage } from "@/lib/convexErrors";
import { useToast } from "@/components/shared/Toast.context";

const INTEGRATIONS = [
  { id: "gmail", labelKey: "integration_gmail" },
  { id: "drive", labelKey: "integration_google_drive" },
  { id: "calendar", labelKey: "integration_google_calendar" },
  { id: "outlook", labelKey: "integration_outlook" },
  { id: "onedrive", labelKey: "integration_onedrive" },
  { id: "ms_calendar", labelKey: "integration_ms_calendar" },
  { id: "apple_calendar", labelKey: "integration_apple_calendar" },
  { id: "notion", labelKey: "integration_notion" },
  { id: "cloze", labelKey: "integration_cloze" },
  { id: "slack", labelKey: "integration_slack" },
] as const;

function IntegrationDefaultsCard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const prefs = useQuery(api.preferences.queries.getPreferences, {});
  const setIntegrationDefault = useMutation(api.preferences.mutations.setIntegrationDefault);
  const removeIntegrationDefault = useMutation(api.preferences.mutations.removeIntegrationDefault);
  const defaults = new Map<string, boolean>(
    (((prefs as { integrationDefaults?: Array<{ integrationId: string; enabled: boolean }> } | null)?.integrationDefaults) ?? [])
      .map((entry) => [entry.integrationId, entry.enabled]),
  );

  async function cycleIntegrationDefault(integrationId: string) {
    const current = defaults.get(integrationId);
    try {
      if (current === undefined) {
        await setIntegrationDefault({ integrationId, enabled: true });
      } else if (current === true) {
        await setIntegrationDefault({ integrationId, enabled: false });
      } else {
        await removeIntegrationDefault({ integrationId });
      }
    } catch (error) {
      toast({ message: convexErrorMessage(error, t("integration_default_update_failed")), variant: "error" });
    }
  }

  return (
    <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
      {INTEGRATIONS.map((integration) => {
        const current = defaults.get(integration.id);
        const label = current === undefined
          ? t("integration_state_default_disabled")
          : current
            ? t("integration_state_enabled")
            : t("integration_state_disabled");
        const className = current === true
          ? "bg-green-500/15 text-green-600 dark:text-green-400"
          : current === false
            ? "bg-red-500/15 text-red-600 dark:text-red-400"
            : "bg-surface-3 text-muted";
        return (
          <button
            key={integration.id}
            onClick={() => void cycleIntegrationDefault(integration.id)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
          >
            <div className="flex-1">
              <p className="text-sm">{t(integration.labelKey)}</p>
              <p className="text-xs text-muted mt-0.5">{t("settings_integration_defaults_help")}</p>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${className}`}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Integrations sub-page ─────────────────────────────────────────────────

function IntegrationsSubPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <ProGateWrapper feature="Integrations">
        <ConnectedAccountsSection />
      </ProGateWrapper>

      <div className="space-y-2">
        <h3 className="text-xs font-medium text-foreground/50 uppercase tracking-wide px-1">{t("default_tool_access")}</h3>
        <IntegrationDefaultsCard />
      </div>

      {/* Suggest integration */}
      <div className="rounded-2xl bg-surface-2 overflow-hidden">
        <a
          href="mailto:support@nanthai.tech?subject=Integration%20Request"
          className="flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors"
        >
          <span className="text-muted">
            <Mail size={16} className="flex-shrink-0" />
          </span>
          <span className="flex-1 text-sm">{t("suggest_new_integration")}</span>
        </a>
      </div>

      <p className="text-xs text-muted px-1">
        {t("integrations_footer")}
      </p>
    </div>
  );
}

// ─── Section row (shown in settings list) ──────────────────────────────────

interface IntegrationsSectionProps {
  onNavigate: (subPage: "integrations") => void;
}

export function IntegrationsSection({ onNavigate }: IntegrationsSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl bg-surface-2 overflow-hidden">
      <button
        onClick={() => onNavigate("integrations")}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
      >
        <span className="text-primary flex-shrink-0">
          <Puzzle size={18} />
        </span>
        <span className="flex-1 text-sm">{t("integrations")}</span>
        <ChevronRight size={14} className="text-muted flex-shrink-0" />
      </button>
    </div>
  );
}

export { IntegrationsSubPage };
