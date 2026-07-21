import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  MessageSquare,
  Paperclip,
  Presentation,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { getFeature } from "./featureData";
import {
  FeaturePageLayout,
  type Capability,
  type HowItWorksStep,
} from "./FeaturePageLayout";
import { DocumentWorkflowsIllustration } from "./illustrations/DocumentWorkflowsIllustration";

const meta = getFeature("documents")!;

function getSteps(t: (key: string) => string): HowItWorksStep[] {
  return [
    {
      number: 1,
      title: t("dw_step1_title"),
      description: t("dw_step1_desc"),
      icon: <MessageSquare size={18} />,
    },
    {
      number: 2,
      title: t("dw_step2_title"),
      description: t("dw_step2_desc"),
      icon: <Paperclip size={18} />,
    },
    {
      number: 3,
      title: t("dw_step3_title"),
      description: t("dw_step3_desc"),
      icon: <RefreshCw size={18} />,
    },
    {
      number: 4,
      title: t("dw_step4_title"),
      description: t("dw_step4_desc"),
      icon: <Download size={18} />,
    },
  ];
}

function getCapabilities(t: (key: string) => string): Capability[] {
  return [
    {
      icon: <FileText size={18} />,
      title: t("dw_cap_docx_title"),
      description: t("dw_cap_docx_desc"),
    },
    {
      icon: <CheckCircle2 size={18} />,
      title: t("dw_cap_changes_title"),
      description: t("dw_cap_changes_desc"),
    },
    {
      icon: <FileSpreadsheet size={18} />,
      title: t("dw_cap_xlsx_title"),
      description: t("dw_cap_xlsx_desc"),
    },
    {
      icon: <Presentation size={18} />,
      title: t("dw_cap_pptx_title"),
      description: t("dw_cap_pptx_desc"),
    },
    {
      icon: <Paperclip size={18} />,
      title: t("dw_cap_sources_title"),
      description: t("dw_cap_sources_desc"),
    },
    {
      icon: <Download size={18} />,
      title: t("dw_cap_reuse_title"),
      description: t("dw_cap_reuse_desc"),
    },
  ];
}

function getScenarios(t: (key: string) => string): string[] {
  return [
    t("dw_scenario_1"),
    t("dw_scenario_2"),
    t("dw_scenario_3"),
    t("dw_scenario_4"),
  ];
}

export function DocumentWorkflowsPage() {
  const { t } = useTranslation();

  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<DocumentWorkflowsIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      seoDescription={t("dw_seo_desc")}
    />
  );
}
