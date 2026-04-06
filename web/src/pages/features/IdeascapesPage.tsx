import {
  Sparkles,
  Move,
  GitBranch,
  ZoomIn,
  Layers,
  MousePointer2,
  Save,
  MessageSquare,
  ArrowRightLeft,
  Plus,
  Focus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { IdeascapesIllustration } from "./illustrations/IdeascapesIllustration";

/* ------------------------------------------------------------------ */
/*  Ideascapes — Feature Page                                          */
/*  /features/ideascapes                                               */
/* ------------------------------------------------------------------ */

const meta = getFeature("ideascapes")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    { number: 1, title: t("is_step1_title"), description: t("is_step1_desc"), icon: <ArrowRightLeft size={18} /> },
    { number: 2, title: t("is_step2_title"), description: t("is_step2_desc"), icon: <GitBranch size={18} /> },
    { number: 3, title: t("is_step3_title"), description: t("is_step3_desc"), icon: <Focus size={18} /> },
    { number: 4, title: t("is_step4_title"), description: t("is_step4_desc"), icon: <Save size={18} /> },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    { icon: <Move size={18} />, title: t("is_cap_drag_title"), description: t("is_cap_drag_desc") },
    { icon: <ZoomIn size={18} />, title: t("is_cap_zoom_title"), description: t("is_cap_zoom_desc") },
    { icon: <Plus size={18} />, title: t("is_cap_context_title"), description: t("is_cap_context_desc") },
    { icon: <Layers size={18} />, title: t("is_cap_multimodel_title"), description: t("is_cap_multimodel_desc") },
    { icon: <Focus size={18} />, title: t("is_cap_focus_title"), description: t("is_cap_focus_desc") },
    { icon: <MousePointer2 size={18} />, title: t("is_cap_persistent_title"), description: t("is_cap_persistent_desc") },
    { icon: <MessageSquare size={18} />, title: t("is_cap_chat_title"), description: t("is_cap_chat_desc") },
    { icon: <ArrowRightLeft size={18} />, title: t("is_cap_toggle_title"), description: t("is_cap_toggle_desc") },
    { icon: <Sparkles size={18} />, title: t("is_cap_help_title"), description: t("is_cap_help_desc") },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [t("is_scenario_1"), t("is_scenario_2"), t("is_scenario_3"), t("is_scenario_4"), t("is_scenario_5")];
}

export function IdeascapesPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<IdeascapesIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("is_seo_desc")}
    />
  );
}
