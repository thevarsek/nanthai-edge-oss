import {
  Bot,
  CheckCircle2,
  GitMerge,
  Layers3,
  ListChecks,
  Puzzle,
  SlidersHorizontal,
  Sparkles,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { FeaturePageLayout, type Capability, type HowItWorksStep } from "./FeaturePageLayout";
import { getFeature } from "./featureData";
import { SkillsHelpersIllustration } from "./illustrations/SkillsHelpersIllustration";

const meta = getFeature("skills-helpers")!;

function getSteps(t: (key: string) => string): HowItWorksStep[] {
  return [
    { number: 1, title: t("sh_step1_title"), description: t("sh_step1_desc"), icon: <Puzzle size={18} /> },
    { number: 2, title: t("sh_step2_title"), description: t("sh_step2_desc"), icon: <SlidersHorizontal size={18} /> },
    { number: 3, title: t("sh_step3_title"), description: t("sh_step3_desc"), icon: <Users size={18} /> },
    { number: 4, title: t("sh_step4_title"), description: t("sh_step4_desc"), icon: <GitMerge size={18} /> },
  ];
}

function getCapabilities(t: (key: string) => string): Capability[] {
  return [
    { icon: <Sparkles size={18} />, title: t("sh_cap_catalog_title"), description: t("sh_cap_catalog_desc") },
    { icon: <Puzzle size={18} />, title: t("sh_cap_custom_title"), description: t("sh_cap_custom_desc") },
    { icon: <Layers3 size={18} />, title: t("sh_cap_scope_title"), description: t("sh_cap_scope_desc") },
    { icon: <Bot size={18} />, title: t("sh_cap_helpers_title"), description: t("sh_cap_helpers_desc") },
    { icon: <ListChecks size={18} />, title: t("sh_cap_tools_title"), description: t("sh_cap_tools_desc") },
    { icon: <CheckCircle2 size={18} />, title: t("sh_cap_control_title"), description: t("sh_cap_control_desc") },
  ];
}

export function SkillsHelpersPage() {
  const { t } = useTranslation();

  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<SkillsHelpersIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={[t("sh_scenario_1"), t("sh_scenario_2"), t("sh_scenario_3"), t("sh_scenario_4")]}
      seoDescription={t("sh_seo_desc")}
    />
  );
}
