import { Puzzle, ChevronRight, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProGateWrapper } from "@/hooks/useProGate";
import { ConnectedAccountsSection } from "@/components/settings/ConnectedAccountsSection";

// ─── Integrations sub-page ─────────────────────────────────────────────────

function IntegrationsSubPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <ProGateWrapper feature="Integrations">
        <ConnectedAccountsSection />
      </ProGateWrapper>

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
