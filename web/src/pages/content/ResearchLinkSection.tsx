import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { contentLanguage, contentPath, type ContentLanguage } from "@/lib/contentLocale";

/** Shared discovery link uses the site's existing typography, borders and spacing. */
export function ResearchLinkSection({ language }: { language?: ContentLanguage }) {
  const { i18n } = useTranslation();
  const locale = language ?? contentLanguage(i18n.resolvedLanguage ?? i18n.language);
  const t = i18n.getFixedT(locale);
  return <section className="container edge-sans pb-16" aria-labelledby="research-link-heading">
    <div className="border-t eborder-06 pt-10 md:flex md:items-center md:justify-between md:gap-12">
      <div className="max-w-2xl">
        <h2 id="research-link-heading" className="edge-display text-2xl efg-heading">{t("content_research_heading")}</h2>
        <p className="mt-4 leading-relaxed efg-60">{t("content_research_intro")}</p>
      </div>
      <Link to={contentPath("research", locale)} className="mt-6 inline-flex shrink-0 items-center gap-2 text-sm efg-70 underline underline-offset-4 md:mt-0">
        {t("content_read_research")}<ArrowRight aria-hidden="true" className="h-4 w-4" />
      </Link>
    </div>
  </section>;
}
