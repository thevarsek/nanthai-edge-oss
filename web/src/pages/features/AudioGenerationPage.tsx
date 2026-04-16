import {
  Mic,
  MessageSquare,
  Clock,
  Headphones,
  Music,
  Sparkles,
  Play,
  Download,
  BookOpen,
  UserCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { AudioGenerationIllustration } from "./illustrations/AudioGenerationIllustration";

/* ------------------------------------------------------------------ */
/*  Audio Generation — Feature Page                                    */
/*  /features/audio-generation                                         */
/* ------------------------------------------------------------------ */

const meta = getFeature("audio-generation")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    {
      number: 1,
      title: t("ag_step1_title"),
      description: t("ag_step1_desc"),
      icon: <Mic size={18} />,
    },
    {
      number: 2,
      title: t("ag_step2_title"),
      description: t("ag_step2_desc"),
      icon: <MessageSquare size={18} />,
    },
    {
      number: 3,
      title: t("ag_step3_title"),
      description: t("ag_step3_desc"),
      icon: <Clock size={18} />,
    },
    {
      number: 4,
      title: t("ag_step4_title"),
      description: t("ag_step4_desc"),
      icon: <Headphones size={18} />,
    },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    {
      icon: <Music size={18} />,
      title: t("ag_cap_models_title"),
      description: t("ag_cap_models_desc"),
    },
    {
      icon: <Sparkles size={18} />,
      title: t("ag_cap_prompts_title"),
      description: t("ag_cap_prompts_desc"),
    },
    {
      icon: <Play size={18} />,
      title: t("ag_cap_player_title"),
      description: t("ag_cap_player_desc"),
    },
    {
      icon: <Download size={18} />,
      title: t("ag_cap_download_title"),
      description: t("ag_cap_download_desc"),
    },
    {
      icon: <BookOpen size={18} />,
      title: t("ag_cap_kb_title"),
      description: t("ag_cap_kb_desc"),
    },
    {
      icon: <UserCircle size={18} />,
      title: t("ag_cap_persona_title"),
      description: t("ag_cap_persona_desc"),
    },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [
    t("ag_scenario_1"),
    t("ag_scenario_2"),
    t("ag_scenario_3"),
    t("ag_scenario_4"),
    t("ag_scenario_5"),
  ];
}

export function AudioGenerationPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<AudioGenerationIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("ag_seo_desc")}
    />
  );
}
