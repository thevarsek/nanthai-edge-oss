import {
  Sun,
  Moon,
  Monitor,
  Palette,
  Paintbrush,
  SwatchBook,
  Smartphone,
  Eye,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { ThemesIllustration } from "./illustrations/ThemesIllustration";

/* ------------------------------------------------------------------ */
/*  Themes & Appearance — Feature Page                                 */
/*  /features/themes                                                   */
/* ------------------------------------------------------------------ */

const meta = getFeature("themes")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    {
      number: 1,
      title: t("th_step1_title"),
      description: t("th_step1_desc"),
      icon: <Palette size={18} />,
    },
    {
      number: 2,
      title: t("th_step2_title"),
      description: t("th_step2_desc"),
      icon: <Monitor size={18} />,
    },
    {
      number: 3,
      title: t("th_step3_title"),
      description: t("th_step3_desc"),
      icon: <Paintbrush size={18} />,
    },
    {
      number: 4,
      title: t("th_step4_title"),
      description: t("th_step4_desc"),
      icon: <Smartphone size={18} />,
    },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    {
      icon: <Moon size={18} />,
      title: t("th_cap_dark_title"),
      description: t("th_cap_dark_desc"),
    },
    {
      icon: <Sun size={18} />,
      title: t("th_cap_light_title"),
      description: t("th_cap_light_desc"),
    },
    {
      icon: <Monitor size={18} />,
      title: t("th_cap_system_title"),
      description: t("th_cap_system_desc"),
    },
    {
      icon: <SwatchBook size={18} />,
      title: t("th_cap_accents_title"),
      description: t("th_cap_accents_desc"),
    },
    {
      icon: <Eye size={18} />,
      title: t("th_cap_a11y_title"),
      description: t("th_cap_a11y_desc"),
    },
    {
      icon: <Smartphone size={18} />,
      title: t("th_cap_sync_title"),
      description: t("th_cap_sync_desc"),
    },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [
    t("th_scenario_1"),
    t("th_scenario_2"),
    t("th_scenario_3"),
    t("th_scenario_4"),
  ];
}

export function ThemesPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<ThemesIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("th_seo_desc")}
    />
  );
}
