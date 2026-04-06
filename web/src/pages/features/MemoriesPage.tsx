import {
  Brain,
  Eye,
  Search,
  Tag,
  Trash2,
  MessageSquare,
  Shield,
  Sparkles,
  FileText,
  Clock,
  Pin,
  SlidersHorizontal,
  UserCircle,
  CheckCircle,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { MemoriesIllustration } from "./illustrations/MemoriesIllustration";

/* ------------------------------------------------------------------ */
/*  Memories — Feature Page                                            */
/*  /features/memories                                                 */
/* ------------------------------------------------------------------ */

const meta = getFeature("memories")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    { number: 1, title: t("me_step1_title"), description: t("me_step1_desc"), icon: <Brain size={18} /> },
    { number: 2, title: t("me_step2_title"), description: t("me_step2_desc"), icon: <Eye size={18} /> },
    { number: 3, title: t("me_step3_title"), description: t("me_step3_desc"), icon: <Sparkles size={18} /> },
    { number: 4, title: t("me_step4_title"), description: t("me_step4_desc"), icon: <RefreshCw size={18} /> },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    { icon: <Tag size={18} />, title: t("me_cap_categories_title"), description: t("me_cap_categories_desc") },
    { icon: <SlidersHorizontal size={18} />, title: t("me_cap_retrieval_title"), description: t("me_cap_retrieval_desc") },
    { icon: <FileText size={18} />, title: t("me_cap_import_title"), description: t("me_cap_import_desc") },
    { icon: <CheckCircle size={18} />, title: t("me_cap_pending_title"), description: t("me_cap_pending_desc") },
    { icon: <Brain size={18} />, title: t("me_cap_extraction_title"), description: t("me_cap_extraction_desc") },
    { icon: <Pin size={18} />, title: t("me_cap_pin_title"), description: t("me_cap_pin_desc") },
    { icon: <UserCircle size={18} />, title: t("me_cap_persona_title"), description: t("me_cap_persona_desc") },
    { icon: <Clock size={18} />, title: t("me_cap_expiry_title"), description: t("me_cap_expiry_desc") },
    { icon: <RefreshCw size={18} />, title: t("me_cap_reinforce_title"), description: t("me_cap_reinforce_desc") },
    { icon: <Search size={18} />, title: t("me_cap_semantic_title"), description: t("me_cap_semantic_desc") },
    { icon: <MessageSquare size={18} />, title: t("me_cap_sections_title"), description: t("me_cap_sections_desc") },
    { icon: <Eye size={18} />, title: t("me_cap_transparent_title"), description: t("me_cap_transparent_desc") },
    { icon: <Trash2 size={18} />, title: t("me_cap_control_title"), description: t("me_cap_control_desc") },
    { icon: <Shield size={18} />, title: t("me_cap_pro_title"), description: t("me_cap_pro_desc") },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [t("me_scenario_1"), t("me_scenario_2"), t("me_scenario_3"), t("me_scenario_4"), t("me_scenario_5"), t("me_scenario_6")];
}

export function MemoriesPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<MemoriesIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("me_seo_desc")}
    />
  );
}
