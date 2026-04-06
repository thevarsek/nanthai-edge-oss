import {
  Users,
  Search,
  Sparkles,
  Filter,
  ArrowUpDown,
  Eye,
  Gift,
  Star,
  Zap,
  UserCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { ParticipantOptionsIllustration } from "./illustrations/ParticipantOptionsIllustration";

/* ------------------------------------------------------------------ */
/*  Participant Options — Feature Page                                 */
/*  /features/participant-options                                      */
/* ------------------------------------------------------------------ */

const meta = getFeature("participant-options")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    { number: 1, title: t("po_step1_title"), description: t("po_step1_desc"), icon: <Users size={18} /> },
    { number: 2, title: t("po_step2_title"), description: t("po_step2_desc"), icon: <Filter size={18} /> },
    { number: 3, title: t("po_step3_title"), description: t("po_step3_desc"), icon: <Sparkles size={18} /> },
    { number: 4, title: t("po_step4_title"), description: t("po_step4_desc"), icon: <Star size={18} /> },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    { icon: <Search size={18} />, title: t("po_cap_search_title"), description: t("po_cap_search_desc") },
    { icon: <Filter size={18} />, title: t("po_cap_filters_title"), description: t("po_cap_filters_desc") },
    { icon: <ArrowUpDown size={18} />, title: t("po_cap_sort_title"), description: t("po_cap_sort_desc") },
    { icon: <Sparkles size={18} />, title: t("po_cap_wizard_title"), description: t("po_cap_wizard_desc") },
    { icon: <Eye size={18} />, title: t("po_cap_badges_title"), description: t("po_cap_badges_desc") },
    { icon: <UserCircle size={18} />, title: t("po_cap_personas_title"), description: t("po_cap_personas_desc") },
    { icon: <Gift size={18} />, title: t("po_cap_free_title"), description: t("po_cap_free_desc") },
    { icon: <Zap size={18} />, title: t("po_cap_persisted_title"), description: t("po_cap_persisted_desc") },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [t("po_scenario_1"), t("po_scenario_2"), t("po_scenario_3"), t("po_scenario_4"), t("po_scenario_5")];
}

export function ParticipantOptionsPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<ParticipantOptionsIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("po_seo_desc")}
    />
  );
}
