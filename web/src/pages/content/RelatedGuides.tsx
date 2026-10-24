import { PublicLink as Link } from "@/components/edge-site/PublicLink";
import { useTranslation } from "react-i18next";
import { contentLanguage } from "@/lib/contentLocale";
import { localizedArticles, articlePath } from "./articleData";

export function RelatedGuides({ feature }: { feature: string }) {
  const { t, i18n } = useTranslation();
  const language = contentLanguage(i18n.resolvedLanguage ?? i18n.language);
  const related = localizedArticles("guides", language).filter(article => article.related.includes(feature));
  if (!related.length) return null;
  return <section className="container pb-16 edge-sans" aria-label={t("content_related_guides")}>
    <h2 className="edge-display text-2xl efg-heading">{t("content_related_guides")}</h2>
    <ul className="mt-5 space-y-3 efg-70">{related.map(article => <li key={article.slug}>{t("content_guide")} <Link className="underline underline-offset-4" to={articlePath(article, language)}>{article.title}</Link></li>)}</ul>
  </section>;
}

