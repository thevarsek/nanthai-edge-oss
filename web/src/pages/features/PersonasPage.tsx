import {
  UserCircle,
  MessageSquare,
  SlidersHorizontal,
  Palette,
  Wrench,
  CalendarClock,
  Users,
  Brain,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { PersonasIllustration } from "./illustrations/PersonasIllustration";

/* ------------------------------------------------------------------ */
/*  Personas — Feature Page                                            */
/*  /features/personas                                                 */
/* ------------------------------------------------------------------ */

const meta = getFeature("personas")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    { number: 1, title: t("pe_step1_title"), description: t("pe_step1_desc"), icon: <UserCircle size={18} /> },
    { number: 2, title: t("pe_step2_title"), description: t("pe_step2_desc"), icon: <SlidersHorizontal size={18} /> },
    { number: 3, title: t("pe_step3_title"), description: t("pe_step3_desc"), icon: <MessageSquare size={18} /> },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    { icon: <Palette size={18} />, title: t("pe_cap_avatar_title"), description: t("pe_cap_avatar_desc") },
    { icon: <MessageSquare size={18} />, title: t("pe_cap_prompt_title"), description: t("pe_cap_prompt_desc") },
    { icon: <SlidersHorizontal size={18} />, title: t("pe_cap_model_title"), description: t("pe_cap_model_desc") },
    { icon: <Wrench size={18} />, title: t("pe_cap_tools_title"), description: t("pe_cap_tools_desc") },
    { icon: <Users size={18} />, title: t("pe_cap_compare_title"), description: t("pe_cap_compare_desc") },
    { icon: <CalendarClock size={18} />, title: t("pe_cap_tasks_title"), description: t("pe_cap_tasks_desc") },
    { icon: <Brain size={18} />, title: t("pe_cap_memory_title"), description: t("pe_cap_memory_desc") },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [t("pe_scenario_1"), t("pe_scenario_2"), t("pe_scenario_3"), t("pe_scenario_4")];
}

export function PersonasPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<PersonasIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("pe_seo_desc")}
    />
  );
}
