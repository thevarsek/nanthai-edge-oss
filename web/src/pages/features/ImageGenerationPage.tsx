import {
  Palette,
  MessageSquare,
  Image,
  Download,
  Sparkles,
  BookOpen,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { ImageGenerationIllustration } from "./illustrations/ImageGenerationIllustration";

/* ------------------------------------------------------------------ */
/*  Image Generation — Feature Page                                    */
/*  /features/image-generation                                         */
/* ------------------------------------------------------------------ */

const meta = getFeature("image-generation")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    {
      number: 1,
      title: t("img_step1_title"),
      description: t("img_step1_desc"),
      icon: <Palette size={18} />,
    },
    {
      number: 2,
      title: t("img_step2_title"),
      description: t("img_step2_desc"),
      icon: <MessageSquare size={18} />,
    },
    {
      number: 3,
      title: t("img_step3_title"),
      description: t("img_step3_desc"),
      icon: <Image size={18} />,
    },
    {
      number: 4,
      title: t("img_step4_title"),
      description: t("img_step4_desc"),
      icon: <Download size={18} />,
    },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    {
      icon: <Palette size={18} />,
      title: t("img_cap_models_title"),
      description: t("img_cap_models_desc"),
    },
    {
      icon: <Sparkles size={18} />,
      title: t("img_cap_prompt_title"),
      description: t("img_cap_prompt_desc"),
    },
    {
      icon: <Image size={18} />,
      title: t("img_cap_inline_title"),
      description: t("img_cap_inline_desc"),
    },
    {
      icon: <Download size={18} />,
      title: t("img_cap_download_title"),
      description: t("img_cap_download_desc"),
    },
    {
      icon: <BookOpen size={18} />,
      title: t("img_cap_kb_title"),
      description: t("img_cap_kb_desc"),
    },
    {
      icon: <Users size={18} />,
      title: t("img_cap_multi_title"),
      description: t("img_cap_multi_desc"),
    },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [
    t("img_scenario_1"),
    t("img_scenario_2"),
    t("img_scenario_3"),
    t("img_scenario_4"),
    t("img_scenario_5"),
  ];
}

export function ImageGenerationPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<ImageGenerationIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("img_seo_desc")}
    />
  );
}
