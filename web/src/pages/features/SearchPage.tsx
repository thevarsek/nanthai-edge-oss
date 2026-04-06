import {
  Search,
  Layers,
  FileText,
  BookOpen,
  Zap,
  Clock,
  Globe,
  LinkIcon,
  ListChecks,
  Sparkles,
  Gauge,
  Smartphone,
  Monitor,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { SearchIllustration } from "./illustrations/SearchIllustration";

/* ------------------------------------------------------------------ */
/*  Search & Research — Feature Page                                   */
/*  /features/search                                                   */
/* ------------------------------------------------------------------ */

const meta = getFeature("search")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    { number: 1, title: t("sr_step1_title"), description: t("sr_step1_desc"), icon: <Globe size={18} /> },
    { number: 2, title: t("sr_step2_title"), description: t("sr_step2_desc"), icon: <Layers size={18} /> },
    { number: 3, title: t("sr_step3_title"), description: t("sr_step3_desc"), icon: <Search size={18} /> },
    { number: 4, title: t("sr_step4_title"), description: t("sr_step4_desc"), icon: <LinkIcon size={18} /> },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    { icon: <Zap size={18} />, title: t("sr_cap_basic_title"), description: t("sr_cap_basic_desc") },
    { icon: <Search size={18} />, title: t("sr_cap_websearch_title"), description: t("sr_cap_websearch_desc") },
    { icon: <FileText size={18} />, title: t("sr_cap_paper_title"), description: t("sr_cap_paper_desc") },
    { icon: <Gauge size={18} />, title: t("sr_cap_complexity_title"), description: t("sr_cap_complexity_desc") },
    { icon: <Globe size={18} />, title: t("sr_cap_globe_title"), description: t("sr_cap_globe_desc") },
    { icon: <Smartphone size={18} />, title: t("sr_cap_platform_title"), description: t("sr_cap_platform_desc") },
    { icon: <ListChecks size={18} />, title: t("sr_cap_pipeline_title"), description: t("sr_cap_pipeline_desc") },
    { icon: <BookOpen size={18} />, title: t("sr_cap_kb_title"), description: t("sr_cap_kb_desc") },
    { icon: <Clock size={18} />, title: t("sr_cap_schedule_title"), description: t("sr_cap_schedule_desc") },
    { icon: <Sparkles size={18} />, title: t("sr_cap_model_title"), description: t("sr_cap_model_desc") },
    { icon: <Monitor size={18} />, title: t("sr_cap_default_title"), description: t("sr_cap_default_desc") },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [t("sr_scenario_1"), t("sr_scenario_2"), t("sr_scenario_3"), t("sr_scenario_4"), t("sr_scenario_5")];
}

export function SearchPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<SearchIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("sr_seo_desc")}
    />
  );
}
