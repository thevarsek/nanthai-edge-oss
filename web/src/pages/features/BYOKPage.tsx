import {
  Key,
  Shield,
  ExternalLink,
  DollarSign,
  Server,
  Zap,
  Lock,
  ArrowRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { BYOKIllustration } from "./illustrations/BYOKIllustration";
import { AnimateOnScroll } from "./illustrations/IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Bring Your Own Key — Feature Page                                  */
/*  /features/byok                                                     */
/* ------------------------------------------------------------------ */

const meta = getFeature("byok")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    {
      number: 1,
      title: t("bk_step1_title"),
      description: t("bk_step1_desc"),
      icon: <Key size={18} />,
    },
    {
      number: 2,
      title: t("bk_step2_title"),
      description: t("bk_step2_desc"),
      icon: <Zap size={18} />,
    },
    {
      number: 3,
      title: t("bk_step3_title"),
      description: t("bk_step3_desc"),
      icon: <DollarSign size={18} />,
    },
    {
      number: 4,
      title: t("bk_step4_title"),
      description: t("bk_step4_desc"),
      icon: <Server size={18} />,
    },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    {
      icon: <DollarSign size={18} />,
      title: t("bk_cap_zero_title"),
      description: t("bk_cap_zero_desc"),
    },
    {
      icon: <Shield size={18} />,
      title: t("bk_cap_oauth_title"),
      description: t("bk_cap_oauth_desc"),
    },
    {
      icon: <Server size={18} />,
      title: t("bk_cap_provider_title"),
      description: t("bk_cap_provider_desc"),
    },
    {
      icon: <Key size={18} />,
      title: t("bk_cap_models_title"),
      description: t("bk_cap_models_desc"),
    },
    {
      icon: <Zap size={18} />,
      title: t("bk_cap_cost_title"),
      description: t("bk_cap_cost_desc"),
    },
    {
      icon: <Lock size={18} />,
      title: t("bk_cap_control_title"),
      description: t("bk_cap_control_desc"),
    },
    {
      icon: <ExternalLink size={18} />,
      title: t("bk_cap_dashboard_title"),
      description: t("bk_cap_dashboard_desc"),
    },
    {
      icon: <ArrowRight size={18} />,
      title: t("bk_cap_disconnect_title"),
      description: t("bk_cap_disconnect_desc"),
    },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [
    t("bk_scenario_1"),
    t("bk_scenario_2"),
    t("bk_scenario_3"),
    t("bk_scenario_4"),
  ];
}

/* ── Extra content: OpenRouter BYOK explainer ────────────────────── */

function BYOKExplainer() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl">
      <AnimateOnScroll>
        <div className="rounded-2xl border border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)] p-6 md:p-8">
          <h3 className="text-[1.1rem] font-semibold efg-heading mb-3">
            {t("bk_explainer_title")}
          </h3>
          <p className="text-[0.88rem] leading-relaxed efg-50 mb-4">
            {t("bk_explainer_intro")}
          </p>
          <ul className="space-y-2 text-[0.85rem] leading-relaxed efg-50">
            <li className="flex items-start gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--edge-cyan)]" />
              <span>{t("bk_explainer_bullet1")}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--edge-cyan)]" />
              <span>{t("bk_explainer_bullet2")}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--edge-cyan)]" />
              <span>{t("bk_explainer_bullet3")}</span>
            </li>
          </ul>
          <p className="mt-4 text-[0.82rem] efg-35">
            {t("bk_explainer_learn_more")}{" "}
            <a
              href="https://openrouter.ai/docs/guides/overview/auth/byok"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[rgba(var(--edge-fg),0.2)] hover:decoration-[rgba(var(--edge-fg),0.5)] transition-colors"
            >
              {t("bk_explainer_docs_link")}
            </a>
            .
          </p>
        </div>
      </AnimateOnScroll>
    </div>
  );
}

export function BYOKPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<BYOKIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      extraContent={<BYOKExplainer />}
      seoDescription={t("bk_seo_desc")}
    />
  );
}
