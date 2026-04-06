import {
  SlidersHorizontal,
  Star,
  Thermometer,
  Hash,
  UserCircle,
  Zap,
  Palette,
  ArrowRightLeft,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { ChatDefaultsIllustration } from "./illustrations/ChatDefaultsIllustration";

/* ------------------------------------------------------------------ */
/*  Chat Defaults & Favorites — Feature Page                           */
/*  /features/chat-defaults                                            */
/* ------------------------------------------------------------------ */

const meta = getFeature("chat-defaults")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    { number: 1, title: t("cd_step1_title"), description: t("cd_step1_desc"), icon: <SlidersHorizontal size={18} /> },
    { number: 2, title: t("cd_step2_title"), description: t("cd_step2_desc"), icon: <Star size={18} /> },
    { number: 3, title: t("cd_step3_title"), description: t("cd_step3_desc"), icon: <Zap size={18} /> },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    { icon: <SlidersHorizontal size={18} />, title: t("cd_cap_default_model_title"), description: t("cd_cap_default_model_desc") },
    { icon: <Thermometer size={18} />, title: t("cd_cap_temp_title"), description: t("cd_cap_temp_desc") },
    { icon: <Hash size={18} />, title: t("cd_cap_tokens_title"), description: t("cd_cap_tokens_desc") },
    { icon: <Star size={18} />, title: t("cd_cap_favstrip_title"), description: t("cd_cap_favstrip_desc") },
    { icon: <ArrowRightLeft size={18} />, title: t("cd_cap_multifav_title"), description: t("cd_cap_multifav_desc") },
    { icon: <UserCircle size={18} />, title: t("cd_cap_personafav_title"), description: t("cd_cap_personafav_desc") },
    { icon: <Palette size={18} />, title: t("cd_cap_override_title"), description: t("cd_cap_override_desc") },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [t("cd_scenario_1"), t("cd_scenario_2"), t("cd_scenario_3"), t("cd_scenario_4")];
}

export function ChatDefaultsPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<ChatDefaultsIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("cd_seo_desc")}
    />
  );
}
