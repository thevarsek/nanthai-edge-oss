import { Check, MessageSquareMore, PencilLine, ArrowRight, Cloud, Laptop } from "lucide-react";
import { PublicLink as Link } from "@/components/edge-site/PublicLink";
import { useTranslation } from "react-i18next";
import { EdgeSiteLayout } from "@/components/edge-site/EdgeSiteLayout";
import { AnimateOnScroll } from "@/pages/features/illustrations/IllustrationPrimitives";
import { Seo } from "@/components/Seo";

export function WorkflowsPage() {
  const { t } = useTranslation();
  return <EdgeSiteLayout activePage="workflows"><Seo title={`${t("work_title").replace(/[.。]$/, "")} | NanthAI`} description={t("work_intro")} url="https://nanthai.tech/workflows" />
    <article className="container edge-sans py-16 md:py-24">
      <AnimateOnScroll>
      <h1 className="edge-display text-[clamp(2.8rem,6vw,5.5rem)] uppercase leading-[1.05] efg-heading max-w-5xl text-balance">{t("work_title")}</h1>
      <p className="mt-8 max-w-3xl text-xl leading-relaxed efg-70">{t("work_intro")}</p>
      <Link to="/sign-in" className="mt-8 inline-flex rounded-full ecta px-7 py-3 font-medium">{t("work_start")}</Link>
      </AnimateOnScroll>
      <ol className="mt-16 grid gap-8 md:grid-cols-3">
        {[PencilLine, MessageSquareMore, Check].map((Icon, index) => <li key={index} className="border-t eborder-12 pt-6"><AnimateOnScroll delay={index * 0.08}>
          <Icon size={28} className="edge-accent" aria-hidden="true" />
          <h2 className="edge-display mt-5 text-2xl efg-heading">{t(`work_step${index + 1}_title`)}</h2>
          <p className="mt-4 leading-relaxed efg-60">{t(`work_step${index + 1}_body`)}</p>
        </AnimateOnScroll></li>)}
      </ol>
      {["choose", "context"].map(section => <AnimateOnScroll key={section} className="mt-16 grid gap-8 border-t eborder-12 pt-10 md:grid-cols-[1fr_1.2fr]">
        <h2 className="edge-display text-3xl uppercase efg-heading">{t(`work_${section}_title`)}</h2>
        <div className="max-w-xl leading-relaxed efg-60"><p>{t(`work_${section}_body`)}</p><p className="mt-4">{t(`work_${section}_detail`)}</p></div>
      </AnimateOnScroll>)}
      <AnimateOnScroll className="mt-16 border-t eborder-12 pt-10">
        <h2 className="edge-display max-w-4xl text-3xl uppercase efg-heading">{t("work_connection_title")}</h2>
        <div className="mt-8 grid gap-10 md:grid-cols-2">
          <div><Cloud size={28} className="edge-accent" aria-hidden="true" /><h3 className="edge-display mt-5 text-2xl efg-heading">OpenRouter</h3><p className="mt-4 max-w-xl leading-relaxed efg-60">{t("work_connection_body")}</p></div>
          <div><Laptop size={28} className="edge-accent" aria-hidden="true" /><h3 className="edge-display mt-5 text-2xl efg-heading">{t("work_mac_title")}</h3><p className="mt-4 max-w-xl leading-relaxed efg-60">{t("work_connection_detail")}</p><Link to="/local-runtime" className="mt-6 inline-flex items-center gap-2 edge-accent underline underline-offset-4">{t("work_how")}<ArrowRight size={16} /></Link></div>
        </div>
      </AnimateOnScroll>
      <div className="mt-14 flex flex-wrap items-center gap-3"><Link to="/sign-in" className="inline-flex min-h-12 items-center justify-center rounded-full border border-transparent ecta px-7 py-3 font-medium">{t("work_start")}</Link><Link to="/features" className="inline-flex min-h-12 items-center justify-center rounded-full border eborder-12 px-7 py-3 font-medium edge-accent hover:ebg-glass-02">{t("work_features")}</Link></div>
    </article>
  </EdgeSiteLayout>;
}
