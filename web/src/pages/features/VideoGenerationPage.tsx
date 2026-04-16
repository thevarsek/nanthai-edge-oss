import {
  Film,
  MessageSquare,
  Clock,
  Play,
  ImagePlus,
  SlidersHorizontal,
  Loader,
  Download,
  Layers,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { VideoGenerationIllustration } from "./illustrations/VideoGenerationIllustration";

/* ------------------------------------------------------------------ */
/*  Video Generation — Feature Page                                    */
/*  /features/video-generation                                         */
/* ------------------------------------------------------------------ */

const meta = getFeature("video-generation")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    {
      number: 1,
      title: t("vg_step1_title"),
      description: t("vg_step1_desc"),
      icon: <Film size={18} />,
    },
    {
      number: 2,
      title: t("vg_step2_title"),
      description: t("vg_step2_desc"),
      icon: <MessageSquare size={18} />,
    },
    {
      number: 3,
      title: t("vg_step3_title"),
      description: t("vg_step3_desc"),
      icon: <Clock size={18} />,
    },
    {
      number: 4,
      title: t("vg_step4_title"),
      description: t("vg_step4_desc"),
      icon: <Play size={18} />,
    },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    {
      icon: <Film size={18} />,
      title: t("vg_cap_models_title"),
      description: t("vg_cap_models_desc"),
    },
    {
      icon: <ImagePlus size={18} />,
      title: t("vg_cap_frames_title"),
      description: t("vg_cap_frames_desc"),
    },
    {
      icon: <SlidersHorizontal size={18} />,
      title: t("vg_cap_settings_title"),
      description: t("vg_cap_settings_desc"),
    },
    {
      icon: <Loader size={18} />,
      title: t("vg_cap_progress_title"),
      description: t("vg_cap_progress_desc"),
    },
    {
      icon: <Play size={18} />,
      title: t("vg_cap_player_title"),
      description: t("vg_cap_player_desc"),
    },
    {
      icon: <Download size={18} />,
      title: t("vg_cap_download_title"),
      description: t("vg_cap_download_desc"),
    },
    {
      icon: <Layers size={18} />,
      title: t("vg_cap_modality_title"),
      description: t("vg_cap_modality_desc"),
    },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [
    t("vg_scenario_1"),
    t("vg_scenario_2"),
    t("vg_scenario_3"),
    t("vg_scenario_4"),
    t("vg_scenario_5"),
  ];
}

export function VideoGenerationPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<VideoGenerationIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("vg_seo_desc")}
    />
  );
}
