import { CalendarClock, Code2, Download, FileText, Laptop, Link2, Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { FeaturePageLayout } from "./FeaturePageLayout";
import { getFeature } from "./featureData";
import { MockPanel } from "./illustrations/IllustrationPrimitives";
import { RuntimeDownloadLink } from "@/components/shared/RuntimeDownloadLink";

export function LocalRuntimeFeaturePage() {
  const { t } = useTranslation();
  const meta = getFeature("local-runtime");
  if (!meta) return null;
  const steps = [
    { number: 1, title: t("local_work_install_title"), description: t("local_work_install"), icon: <Download size={18} /> },
    { number: 2, title: t("local_work_pair_title"), description: t("local_work_pair"), icon: <Link2 size={18} /> },
    { number: 3, title: t("local_work_choose_title"), description: t("local_work_choose"), icon: <Smartphone size={18} /> },
  ];
  const capabilities = [
    { icon: <Code2 size={18} />, title: "Codex", description: t("local_work_codex") },
    { icon: <Laptop size={18} />, title: "Pi", description: t("local_work_pi") },
    { icon: <FileText size={18} />, title: t("local_work_share_title"), description: t("local_work_share") },
    { icon: <CalendarClock size={18} />, title: t("local_work_schedule_title"), description: t("local_work_schedule") },
  ];
  return <FeaturePageLayout
    meta={meta}
    seoDescription={t("lr_seo_desc")}
    steps={steps}
    capabilities={capabilities}
    scenarios={[]}
    illustration={<MockPanel title={t("local_runtime_title")} className="mx-auto max-w-xl">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-5 p-5 text-center">
        <div><Laptop className="mx-auto mb-4 h-12 w-12 text-[var(--edge-cyan)]" /><p className="font-semibold efg-heading">Codex · Pi</p><p className="mt-2 text-sm efg-50">{t("local_capabilities_title")}</p></div>
        <Link2 className="edge-accent" aria-hidden="true" />
        <div><Smartphone className="mx-auto mb-4 h-12 w-12 text-[var(--edge-cyan)]" /><p className="font-semibold efg-heading">NanthAI</p><p className="mt-2 text-sm efg-50">{t("local_work_choose_title")}</p></div>
      </div>
    </MockPanel>}
    extraContent={<div className="mx-auto max-w-3xl text-center">
      <p className="text-sm leading-relaxed efg-50">{t("local_capabilities_requirements")}</p>
      <p className="mt-3 text-sm leading-relaxed efg-50">{t("local_capabilities_cloud")}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-4">
        <RuntimeDownloadLink fallbackToSetup className="ecta inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold" />
        <Link to="/local-runtime" className="inline-flex items-center gap-2 text-sm edge-accent underline underline-offset-4">{t("work_how")}</Link>
      </div>
    </div>}
  />;
}
