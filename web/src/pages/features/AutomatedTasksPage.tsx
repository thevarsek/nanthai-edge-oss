import {
  CalendarClock,
  Layers,
  Play,
  RefreshCw,
  UserCircle,
  Search,
  Plug,
  Bell,
  Clock,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { AutomatedTasksIllustration } from "./illustrations/AutomatedTasksIllustration";

/* ------------------------------------------------------------------ */
/*  Automated Tasks — Feature Page                                     */
/*  /features/automated-tasks                                          */
/* ------------------------------------------------------------------ */

const meta = getFeature("automated-tasks")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    { number: 1, title: t("at_step1_title"), description: t("at_step1_desc"), icon: <CalendarClock size={18} /> },
    { number: 2, title: t("at_step2_title"), description: t("at_step2_desc"), icon: <Layers size={18} /> },
    { number: 3, title: t("at_step3_title"), description: t("at_step3_desc"), icon: <Clock size={18} /> },
    { number: 4, title: t("at_step4_title"), description: t("at_step4_desc"), icon: <RefreshCw size={18} /> },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    { icon: <Layers size={18} />, title: t("at_cap_pipelines_title"), description: t("at_cap_pipelines_desc") },
    { icon: <CalendarClock size={18} />, title: t("at_cap_scheduling_title"), description: t("at_cap_scheduling_desc") },
    { icon: <UserCircle size={18} />, title: t("at_cap_personas_title"), description: t("at_cap_personas_desc") },
    { icon: <Search size={18} />, title: t("at_cap_search_title"), description: t("at_cap_search_desc") },
    { icon: <Plug size={18} />, title: t("at_cap_integrations_title"), description: t("at_cap_integrations_desc") },
    { icon: <Play size={18} />, title: t("at_cap_manual_title"), description: t("at_cap_manual_desc") },
    { icon: <Bell size={18} />, title: t("at_cap_history_title"), description: t("at_cap_history_desc") },
    { icon: <RefreshCw size={18} />, title: t("at_cap_refinement_title"), description: t("at_cap_refinement_desc") },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [t("at_scenario_1"), t("at_scenario_2"), t("at_scenario_3"), t("at_scenario_4"), t("at_scenario_5")];
}

export function AutomatedTasksPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<AutomatedTasksIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("at_seo_desc")}
    />
  );
}
