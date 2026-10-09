import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { EdgeSiteLayout } from "@/components/edge-site/EdgeSiteLayout";
import { AnimateOnScroll } from "@/pages/features/illustrations/IllustrationPrimitives";
import { Seo } from "@/components/Seo";
import { LocalRuntimeWorkflow } from "./LocalRuntimeWorkflow";
import { RuntimeSavings } from "./RuntimeSavings";
import { RuntimeDownloadLink } from "@/components/shared/RuntimeDownloadLink";

export function LocalRuntimePage() {
  const { t } = useTranslation();
  return <EdgeSiteLayout activePage="workflows"><Seo title={`${t("local_work_title").replace(/[.。]$/, "")} | NanthAI`} description={t("local_work_intro")} url="https://nanthai.tech/local-runtime" />
    <article className="container edge-sans py-16 md:py-24">
      <AnimateOnScroll>
      <h1 className="edge-display text-[clamp(2.8rem,6vw,5.5rem)] uppercase leading-[1.05] max-w-5xl text-balance efg-heading">{t("local_work_title")}</h1>
      <p className="mt-8 max-w-3xl text-xl leading-relaxed efg-70">{t("local_work_intro")}</p>
      <div className="mt-8 flex flex-wrap items-center gap-6">
        <RuntimeDownloadLink className="inline-flex min-h-12 items-center justify-center rounded-full border border-transparent ecta px-7 py-3 font-medium" />
        <Link to="/app/settings/local-runtime" className="edge-accent underline underline-offset-4">{t("local_work_start")}</Link>
      </div>
      </AnimateOnScroll>
      <LocalRuntimeWorkflow />
      <RuntimeSavings />
      <div className="mt-14 flex flex-wrap items-center gap-3"><Link to="/app/settings/local-runtime" className="inline-flex min-h-12 items-center justify-center rounded-full border border-transparent ecta px-7 py-3 font-medium">{t("local_work_start")}</Link><Link to="/workflows" className="inline-flex min-h-12 items-center justify-center rounded-full border eborder-12 px-7 py-3 font-medium edge-accent hover:ebg-glass-02">{t("work_home_link")}</Link></div>
    </article>
  </EdgeSiteLayout>;
}
