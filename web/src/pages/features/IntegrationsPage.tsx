import {
  Plug,
  Mail,
  FileText,
  Calendar,
  BookOpen,
  RefreshCw,
  Search,
  Shield,
  UserCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFeature } from "./featureData";
import { FeaturePageLayout, type HowItWorksStep, type Capability } from "./FeaturePageLayout";
import { IntegrationsIllustration } from "./illustrations/IntegrationsIllustration";

/* ------------------------------------------------------------------ */
/*  Integrations — Feature Page                                        */
/*  /features/integrations                                             */
/* ------------------------------------------------------------------ */

const meta = getFeature("integrations")!;

function getSteps(t: (k: string) => string): HowItWorksStep[] {
  return [
    { number: 1, title: t("ig_step1_title"), description: t("ig_step1_desc"), icon: <Plug size={18} /> },
    { number: 2, title: t("ig_step2_title"), description: t("ig_step2_desc"), icon: <Mail size={18} /> },
    { number: 3, title: t("ig_step3_title"), description: t("ig_step3_desc"), icon: <UserCircle size={18} /> },
  ];
}

function getCapabilities(t: (k: string) => string): Capability[] {
  return [
    { icon: <Mail size={18} />, title: t("ig_cap_email_title"), description: t("ig_cap_email_desc") },
    { icon: <FileText size={18} />, title: t("ig_cap_files_title"), description: t("ig_cap_files_desc") },
    { icon: <Calendar size={18} />, title: t("ig_cap_calendar_title"), description: t("ig_cap_calendar_desc") },
    { icon: <BookOpen size={18} />, title: t("ig_cap_notion_title"), description: t("ig_cap_notion_desc") },
    { icon: <Search size={18} />, title: t("ig_cap_search_title"), description: t("ig_cap_search_desc") },
    { icon: <RefreshCw size={18} />, title: t("ig_cap_tasks_title"), description: t("ig_cap_tasks_desc") },
    { icon: <Shield size={18} />, title: t("ig_cap_oauth_title"), description: t("ig_cap_oauth_desc") },
  ];
}

function getScenarios(t: (k: string) => string): string[] {
  return [t("ig_scenario_1"), t("ig_scenario_2"), t("ig_scenario_3"), t("ig_scenario_4")];
}

export function IntegrationsPage() {
  const { t } = useTranslation();
  return (
    <FeaturePageLayout
      meta={meta}
      illustration={<IntegrationsIllustration />}
      steps={getSteps(t)}
      capabilities={getCapabilities(t)}
      scenarios={getScenarios(t)}
      extraContent={
        <div className="mx-auto max-w-3xl rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-center dark:border-amber-400/25">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-200">
            {t("ig_google_coming_soon_title")}
          </p>
          <p className="mt-2 text-sm text-amber-600/85 dark:text-amber-100/85">
            {t("ig_google_coming_soon_body")}
          </p>
        </div>
      }
      seoDescription={t("ig_seo_desc")}
    />
  );
}
