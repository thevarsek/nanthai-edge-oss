import {
  BarChart3,
  Code2,
  Download,
  FileInput,
  FileSpreadsheet,
  PackageOpen,
  Play,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { FeaturePageLayout, type Capability, type HowItWorksStep } from "./FeaturePageLayout";
import { getFeature } from "./featureData";
import { AnalysisCodeIllustration } from "./illustrations/AnalysisCodeIllustration";

const meta = getFeature("analysis-code")!;

function getSteps(t: (key: string) => string): HowItWorksStep[] {
  return [
    { number: 1, title: t("ac_step1_title"), description: t("ac_step1_desc"), icon: <FileInput size={18} /> },
    { number: 2, title: t("ac_step2_title"), description: t("ac_step2_desc"), icon: <Wrench size={18} /> },
    { number: 3, title: t("ac_step3_title"), description: t("ac_step3_desc"), icon: <Play size={18} /> },
    { number: 4, title: t("ac_step4_title"), description: t("ac_step4_desc"), icon: <Download size={18} /> },
  ];
}

function getCapabilities(t: (key: string) => string): Capability[] {
  return [
    { icon: <FileSpreadsheet size={18} />, title: t("ac_cap_files_title"), description: t("ac_cap_files_desc") },
    { icon: <Code2 size={18} />, title: t("ac_cap_code_title"), description: t("ac_cap_code_desc") },
    { icon: <BarChart3 size={18} />, title: t("ac_cap_charts_title"), description: t("ac_cap_charts_desc") },
    { icon: <Download size={18} />, title: t("ac_cap_outputs_title"), description: t("ac_cap_outputs_desc") },
    { icon: <ShieldCheck size={18} />, title: t("ac_cap_isolation_title"), description: t("ac_cap_isolation_desc") },
    { icon: <PackageOpen size={18} />, title: t("ac_cap_heavy_title"), description: t("ac_cap_heavy_desc") },
  ];
}

export function AnalysisCodePage() {
  const { t } = useTranslation();

  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<AnalysisCodeIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={[t("ac_scenario_1"), t("ac_scenario_2"), t("ac_scenario_3"), t("ac_scenario_4")]}
      seoDescription={t("ac_seo_desc")}
    />
  );
}
