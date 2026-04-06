import {
  Crown,
  MessageSquare,
  Search,
  FolderOpen,
  Palette,
  Key,
  UserCircle,
  Brain,
  CalendarClock,
  Plug,
  BookOpen,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { ProVsFreeIllustration } from "./illustrations/ProVsFreeIllustration";

/* ------------------------------------------------------------------ */
/*  Pro vs Free — Feature Page                                         */
/*  /features/pro-vs-free                                              */
/* ------------------------------------------------------------------ */

const meta = getFeature("pro-vs-free")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    { number: 1, title: t("pf_step1_title"), description: t("pf_step1_desc"), icon: <MessageSquare size={18} /> },
    { number: 2, title: t("pf_step2_title"), description: t("pf_step2_desc"), icon: <Key size={18} /> },
    { number: 3, title: t("pf_step3_title"), description: t("pf_step3_desc"), icon: <Crown size={18} /> },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    { icon: <MessageSquare size={18} />, title: t("pf_cap_chat_title"), description: t("pf_cap_chat_desc") },
    { icon: <Search size={18} />, title: t("pf_cap_search_title"), description: t("pf_cap_search_desc") },
    { icon: <FolderOpen size={18} />, title: t("pf_cap_folders_title"), description: t("pf_cap_folders_desc") },
    { icon: <Palette size={18} />, title: t("pf_cap_themes_title"), description: t("pf_cap_themes_desc") },
    { icon: <Key size={18} />, title: t("pf_cap_byok_title"), description: t("pf_cap_byok_desc") },
    { icon: <UserCircle size={18} />, title: t("pf_cap_personas_title"), description: t("pf_cap_personas_desc") },
    { icon: <Brain size={18} />, title: t("pf_cap_memories_title"), description: t("pf_cap_memories_desc") },
    { icon: <CalendarClock size={18} />, title: t("pf_cap_tasks_title"), description: t("pf_cap_tasks_desc") },
    { icon: <Plug size={18} />, title: t("pf_cap_integrations_title"), description: t("pf_cap_integrations_desc") },
    { icon: <BookOpen size={18} />, title: t("pf_cap_kb_title"), description: t("pf_cap_kb_desc") },
    { icon: <Search size={18} />, title: t("pf_cap_research_title"), description: t("pf_cap_research_desc") },
    { icon: <Sparkles size={18} />, title: t("pf_cap_ideascapes_title"), description: t("pf_cap_ideascapes_desc") },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [t("pf_scenario_1"), t("pf_scenario_2"), t("pf_scenario_3"), t("pf_scenario_4")];
}

export function ProVsFreePage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<ProVsFreeIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("pf_seo_desc")}
    />
  );
}
