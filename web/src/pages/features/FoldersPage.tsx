import {
  FolderOpen,
  Search,
  Palette,
  MoveRight,
  Filter,
  FolderPlus,
  Tag,
  CalendarClock,
  Archive,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { FoldersIllustration } from "./illustrations/FoldersIllustration";

/* ------------------------------------------------------------------ */
/*  Folders — Feature Page                                             */
/*  /features/folders                                                  */
/* ------------------------------------------------------------------ */

const meta = getFeature("folders")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    { number: 1, title: t("fo_step1_title"), description: t("fo_step1_desc"), icon: <FolderPlus size={18} /> },
    { number: 2, title: t("fo_step2_title"), description: t("fo_step2_desc"), icon: <MoveRight size={18} /> },
    { number: 3, title: t("fo_step3_title"), description: t("fo_step3_desc"), icon: <Search size={18} /> },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    { icon: <FolderOpen size={18} />, title: t("fo_cap_named_title"), description: t("fo_cap_named_desc") },
    { icon: <Palette size={18} />, title: t("fo_cap_colours_title"), description: t("fo_cap_colours_desc") },
    { icon: <MoveRight size={18} />, title: t("fo_cap_bulk_title"), description: t("fo_cap_bulk_desc") },
    { icon: <Filter size={18} />, title: t("fo_cap_filter_title"), description: t("fo_cap_filter_desc") },
    { icon: <Search size={18} />, title: t("fo_cap_search_title"), description: t("fo_cap_search_desc") },
    { icon: <Tag size={18} />, title: t("fo_cap_sync_title"), description: t("fo_cap_sync_desc") },
    { icon: <Archive size={18} />, title: t("fo_cap_unfiled_title"), description: t("fo_cap_unfiled_desc") },
    { icon: <CalendarClock size={18} />, title: t("fo_cap_scheduled_title"), description: t("fo_cap_scheduled_desc") },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [t("fo_scenario_1"), t("fo_scenario_2"), t("fo_scenario_3"), t("fo_scenario_4")];
}

export function FoldersPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<FoldersIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("fo_seo_desc")}
    />
  );
}
