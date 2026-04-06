import {
  BookOpen,
  Upload,
  Paperclip,
  FileText,
  Search,
  CalendarClock,
  UserCircle,
  Layers,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { KnowledgeBaseIllustration } from "./illustrations/KnowledgeBaseIllustration";

/* ------------------------------------------------------------------ */
/*  Knowledge Base — Feature Page                                      */
/*  /features/knowledge-base                                           */
/* ------------------------------------------------------------------ */

const meta = getFeature("knowledge-base")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    { number: 1, title: t("kb_step1_title"), description: t("kb_step1_desc"), icon: <Upload size={18} /> },
    { number: 2, title: t("kb_step2_title"), description: t("kb_step2_desc"), icon: <Paperclip size={18} /> },
    { number: 3, title: t("kb_step3_title"), description: t("kb_step3_desc"), icon: <Search size={18} /> },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    { icon: <Upload size={18} />, title: t("kb_cap_upload_title"), description: t("kb_cap_upload_desc") },
    { icon: <Paperclip size={18} />, title: t("kb_cap_attach_title"), description: t("kb_cap_attach_desc") },
    { icon: <BookOpen size={18} />, title: t("kb_cap_crossref_title"), description: t("kb_cap_crossref_desc") },
    { icon: <Search size={18} />, title: t("kb_cap_search_title"), description: t("kb_cap_search_desc") },
    { icon: <UserCircle size={18} />, title: t("kb_cap_persona_title"), description: t("kb_cap_persona_desc") },
    { icon: <CalendarClock size={18} />, title: t("kb_cap_tasks_title"), description: t("kb_cap_tasks_desc") },
    { icon: <FileText size={18} />, title: t("kb_cap_manage_title"), description: t("kb_cap_manage_desc") },
    { icon: <Layers size={18} />, title: t("kb_cap_available_title"), description: t("kb_cap_available_desc") },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [t("kb_scenario_1"), t("kb_scenario_2"), t("kb_scenario_3"), t("kb_scenario_4")];
}

export function KnowledgeBasePage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<KnowledgeBaseIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("kb_seo_desc")}
    />
  );
}
