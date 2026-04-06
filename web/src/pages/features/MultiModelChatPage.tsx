import {
  MessageSquare,
  ArrowRightLeft,
  GitBranch,
  Clock,
  Star,
  Layers,
  Shuffle,
  Users,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { MultiModelChatIllustration } from "./illustrations/MultiModelChatIllustration";

/* ------------------------------------------------------------------ */
/*  Multi-Model Chat — Feature Page                                    */
/*  /features/multi-model-chat                                         */
/* ------------------------------------------------------------------ */

const meta = getFeature("multi-model-chat")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    {
      number: 1,
      title: t("mmc_step1_title"),
      description: t("mmc_step1_desc"),
      icon: <SlidersHorizontal size={18} />,
    },
    {
      number: 2,
      title: t("mmc_step2_title"),
      description: t("mmc_step2_desc"),
      icon: <MessageSquare size={18} />,
    },
    {
      number: 3,
      title: t("mmc_step3_title"),
      description: t("mmc_step3_desc"),
      icon: <Layers size={18} />,
    },
    {
      number: 4,
      title: t("mmc_step4_title"),
      description: t("mmc_step4_desc"),
      icon: <GitBranch size={18} />,
    },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    {
      icon: <ArrowRightLeft size={18} />,
      title: t("mmc_cap_compare_title"),
      description: t("mmc_cap_compare_desc"),
    },
    {
      icon: <GitBranch size={18} />,
      title: t("mmc_cap_fork_title"),
      description: t("mmc_cap_fork_desc"),
    },
    {
      icon: <Clock size={18} />,
      title: t("mmc_cap_queue_title"),
      description: t("mmc_cap_queue_desc"),
    },
    {
      icon: <Star size={18} />,
      title: t("mmc_cap_fav_title"),
      description: t("mmc_cap_fav_desc"),
    },
    {
      icon: <Shuffle size={18} />,
      title: t("mmc_cap_retry_title"),
      description: t("mmc_cap_retry_desc"),
    },
    {
      icon: <Users size={18} />,
      title: t("mmc_cap_mix_title"),
      description: t("mmc_cap_mix_desc"),
    },
    {
      icon: <Sparkles size={18} />,
      title: t("mmc_cap_compose_title"),
      description: t("mmc_cap_compose_desc"),
    },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [
    t("mmc_scenario_1"),
    t("mmc_scenario_2"),
    t("mmc_scenario_3"),
    t("mmc_scenario_4"),
    t("mmc_scenario_5"),
  ];
}

export function MultiModelChatPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<MultiModelChatIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("mmc_seo_desc")}
    />
  );
}
