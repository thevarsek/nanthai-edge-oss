import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function HomeWorkflowSection() {
  const { t } = useTranslation();
  return <section className="container py-16 md:py-24" aria-labelledby="home-workflow-title">
    <div className="edge-gradient-line" />
    <div className="grid gap-8 pt-10 md:grid-cols-[1.2fr_1fr] md:gap-16">
      <h2 id="home-workflow-title" className="edge-display text-[clamp(2rem,4.5vw,4rem)] uppercase efg-heading text-balance">{t("work_home_title")}</h2>
      <div className="edge-sans self-end">
        <p className="text-lg leading-relaxed efg-70">{t("work_home_body")}</p>
        <p className="mt-4 leading-relaxed efg-60">{t("work_home_detail")}</p>
        <Link to="/workflows" className="mt-6 inline-flex items-center gap-2 text-sm edge-accent underline underline-offset-4">{t("work_home_link")} <ArrowRight size={16} /></Link>
        <Link to="/local-runtime" className="mt-4 block text-sm edge-accent underline underline-offset-4">{t("work_how")}</Link>
      </div>
    </div>
  </section>;
}
