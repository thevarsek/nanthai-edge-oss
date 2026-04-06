import { DollarSign, Eye, Wallet, BarChart3, Zap, Shield, ChevronDown, Receipt } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { PriceTransparencyIllustration } from "./illustrations/PriceTransparencyIllustration";
import { AnimateOnScroll } from "./illustrations/IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Price Transparency — Feature Page                                  */
/*  /features/price-transparency                                       */
/* ------------------------------------------------------------------ */

const meta = getFeature("price-transparency")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    { number: 1, title: t("pt_step1_title"), description: t("pt_step1_desc"), icon: <Zap size={18} /> },
    { number: 2, title: t("pt_step2_title"), description: t("pt_step2_desc"), icon: <Eye size={18} /> },
    { number: 3, title: t("pt_step3_title"), description: t("pt_step3_desc"), icon: <DollarSign size={18} /> },
    { number: 4, title: t("pt_step4_title"), description: t("pt_step4_desc"), icon: <BarChart3 size={18} /> },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    { icon: <DollarSign size={18} />, title: t("pt_cap_permsg_title"), description: t("pt_cap_permsg_desc") },
    { icon: <BarChart3 size={18} />, title: t("pt_cap_total_title"), description: t("pt_cap_total_desc") },
    { icon: <Receipt size={18} />, title: t("pt_cap_buckets_title"), description: t("pt_cap_buckets_desc") },
    { icon: <Wallet size={18} />, title: t("pt_cap_balance_title"), description: t("pt_cap_balance_desc") },
    { icon: <Eye size={18} />, title: t("pt_cap_multimodel_title"), description: t("pt_cap_multimodel_desc") },
    { icon: <Shield size={18} />, title: t("pt_cap_nomarkup_title"), description: t("pt_cap_nomarkup_desc") },
    { icon: <Zap size={18} />, title: t("pt_cap_streaming_title"), description: t("pt_cap_streaming_desc") },
    { icon: <ChevronDown size={18} />, title: t("pt_cap_toggle_title"), description: t("pt_cap_toggle_desc") },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [t("pt_scenario_1"), t("pt_scenario_2"), t("pt_scenario_3"), t("pt_scenario_4")];
}

/* ── Extra content: breakdown bucket explainer ───────────────────── */

function BreakdownExplainer() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl">
      <AnimateOnScroll>
        <div className="rounded-2xl border border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)] p-6 md:p-8">
          <h3 className="text-[1.1rem] font-semibold efg-heading mb-3">
            {t("pt_breakdown_title")}
          </h3>
          <div className="grid sm:grid-cols-2 gap-4 text-[0.85rem] leading-relaxed efg-50">
            <div>
              <p className="font-semibold efg-70 mb-1">{t("pt_bucket_responses")}</p>
              <p>{t("pt_bucket_responses_desc")}</p>
            </div>
            <div>
              <p className="font-semibold efg-70 mb-1">{t("pt_bucket_memory")}</p>
              <p>{t("pt_bucket_memory_desc")}</p>
            </div>
            <div>
              <p className="font-semibold efg-70 mb-1">{t("pt_bucket_search")}</p>
              <p>{t("pt_bucket_search_desc")}</p>
            </div>
            <div>
              <p className="font-semibold efg-70 mb-1">{t("pt_bucket_other")}</p>
              <p>{t("pt_bucket_other_desc")}</p>
            </div>
          </div>
        </div>
      </AnimateOnScroll>
    </div>
  );
}

export function PriceTransparencyPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<PriceTransparencyIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      extraContent={<BreakdownExplainer />}
      seoDescription={t("pt_seo_desc")}
    />
  );
}
