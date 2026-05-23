import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, LockKeyhole, Sparkles } from "lucide-react";
import { PaywallModal } from "@/components/shared/PaywallModal";
import { useProGate } from "@/hooks/useProGate.hook";

// ─── Gate wrapper ──────────────────────────────────────────────────────────

type ProFeatureId = "scheduledJobs" | "aiPersonas" | "aiSkills" | "knowledgeBase" | "memory" | "integrations";

interface ProGateWrapperProps {
  children: ReactNode;
  /** Stable feature id used to resolve localized paywall copy. */
  featureId?: ProFeatureId;
  /** Optional fallback feature name for legacy call sites. */
  feature?: string;
  /** Compact buttons are for inline settings rows; pages are for direct routes. */
  presentation?: "button" | "page";
}

/**
 * Renders `children` when the user is Pro. Otherwise renders an "Upgrade to
 * Pro" button that opens the PaywallModal when clicked.
 */
export function ProGateWrapper({ children, featureId, feature, presentation = "button" }: ProGateWrapperProps) {
  const { t } = useTranslation();
  const { isPro } = useProGate();
  const [showPaywall, setShowPaywall] = useState(false);
  const copy = proFeatureCopy(featureId, feature, t);

  if (isPro) return <>{children}</>;

  if (presentation === "page") {
    return (
      <LockedFeaturePage
        featureLabel={copy.label}
        featureDescription={copy.description}
        showPaywall={showPaywall}
        onShowPaywall={() => setShowPaywall(true)}
        onClosePaywall={() => setShowPaywall(false)}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowPaywall(true)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        aria-label={copy.label ? `${t("upgrade_to_pro")} — ${copy.label}` : t("upgrade_to_pro")}
      >
        <span className="text-primary flex-shrink-0">
          <LockKeyhole size={16} aria-hidden="true" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm text-foreground">{t("upgrade_to_pro")}</span>
          {copy.label && (
            <span className="block text-xs text-muted mt-0.5 truncate">{copy.label}</span>
          )}
        </span>
        {copy.label && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/12 px-2 py-0.5 rounded-full">
            {t("nanthai_pro")}
          </span>
        )}
        <ChevronRight size={14} className="text-muted flex-shrink-0" aria-hidden="true" />
      </button>

      {showPaywall && (
        <PaywallModal
          feature={copy.label}
          onClose={() => setShowPaywall(false)}
        />
      )}
    </>
  );
}

function LockedFeaturePage({
  featureLabel,
  featureDescription,
  showPaywall,
  onShowPaywall,
  onClosePaywall,
}: {
  featureLabel?: string;
  featureDescription: string;
  showPaywall: boolean;
  onShowPaywall: () => void;
  onClosePaywall: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const title = featureLabel ? t("unlock_arg", { var1: featureLabel }) : t("upgrade_to_nanthai_pro");

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 p-4 border-b border-border/50 flex-shrink-0">
        <button
          type="button"
          onClick={() => navigate("/app/settings")}
          className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
          aria-label={t("openrouter_back_to_settings")}
        >
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold flex-1">{featureLabel ?? t("nanthai_pro")}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="max-w-2xl mx-auto min-h-full flex items-center justify-center">
          <div className="w-full rounded-2xl bg-secondary border border-border p-6 sm:p-8 text-center shadow-sm">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <LockKeyhole size={26} aria-hidden="true" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">{t("nanthai_pro")}</p>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">{title}</h2>
            <p className="mt-3 text-sm leading-6 text-muted">{featureDescription}</p>

            <div className="mt-6 flex flex-col sm:flex-row justify-center gap-3">
              <button
                type="button"
                onClick={onShowPaywall}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Sparkles size={16} aria-hidden="true" />
                {t("get_nanthai_pro")}
              </button>
              <button
                type="button"
                onClick={() => navigate("/app/settings")}
                className="inline-flex items-center justify-center rounded-xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {t("openrouter_back_to_settings")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showPaywall && (
        <PaywallModal
          feature={featureLabel}
          onClose={onClosePaywall}
        />
      )}
    </div>
  );
}

function proFeatureCopy(
  featureId: ProFeatureId | undefined,
  fallbackFeature: string | undefined,
  t: (key: string) => string,
): { label?: string; description: string } {
  switch (featureId) {
    case "aiPersonas":
      return { label: t("personas"), description: t("paywall_personas_description") };
    case "memory":
      return { label: t("memory"), description: t("paywall_memory_description") };
    case "scheduledJobs":
      return { label: t("scheduled_jobs"), description: t("paywall_scheduled_jobs_description") };
    case "aiSkills":
      return { label: t("skills_title"), description: t("paywall_ai_tools_description") };
    case "knowledgeBase":
      return { label: t("knowledge_base"), description: t("paywall_knowledge_base_description") };
    case "integrations":
      return { label: t("integrations"), description: t("paywall_provider_connections_description") };
    default:
      return {
        label: fallbackFeature,
        description: t("unlock_everything_with_a_one_time_purchase_no_subscriptions"),
      };
  }
}
