import {
  GitBranch,
  Repeat,
  ArrowRightLeft,
  Sparkles,
  MessageSquare,
  Layers,
  Plus,
  Focus,
  Eye,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { BranchingIllustration } from "./illustrations/BranchingIllustration";

/* ------------------------------------------------------------------ */
/*  Branching — Feature Page                                           */
/*  /features/branching                                                */
/* ------------------------------------------------------------------ */

const meta = getFeature("branching")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    { number: 1, title: t("br_step1_title"), description: t("br_step1_desc"), icon: <GitBranch size={18} /> },
    { number: 2, title: t("br_step2_title"), description: t("br_step2_desc"), icon: <Repeat size={18} /> },
    { number: 3, title: t("br_step3_title"), description: t("br_step3_desc"), icon: <ArrowRightLeft size={18} /> },
    { number: 4, title: t("br_step4_title"), description: t("br_step4_desc"), icon: <Sparkles size={18} /> },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    { icon: <GitBranch size={18} />, title: t("br_cap_autodetect_title"), description: t("br_cap_autodetect_desc") },
    { icon: <Repeat size={18} />, title: t("br_cap_regen_title"), description: t("br_cap_regen_desc") },
    { icon: <Layers size={18} />, title: t("br_cap_multimodel_title"), description: t("br_cap_multimodel_desc") },
    { icon: <ArrowRightLeft size={18} />, title: t("br_cap_pills_title"), description: t("br_cap_pills_desc") },
    { icon: <Plus size={18} />, title: t("br_cap_merges_title"), description: t("br_cap_merges_desc") },
    { icon: <Focus size={18} />, title: t("br_cap_focus_title"), description: t("br_cap_focus_desc") },
    { icon: <Eye size={18} />, title: t("br_cap_tree_title"), description: t("br_cap_tree_desc") },
    { icon: <MessageSquare size={18} />, title: t("br_cap_continue_title"), description: t("br_cap_continue_desc") },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [t("br_scenario_1"), t("br_scenario_2"), t("br_scenario_3"), t("br_scenario_4"), t("br_scenario_5")];
}

export function BranchingPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<BranchingIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("br_seo_desc")}
    />
  );
}
