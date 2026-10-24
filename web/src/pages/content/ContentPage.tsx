import { PublicLocaleBoundary } from "@/app-routing/PublicLocaleBoundary";
import { useLocation, useParams } from "react-router-dom";
import { PublicLink as Link } from "@/components/edge-site/PublicLink";
import { useTranslation } from "react-i18next";
import { Seo } from "@/components/Seo";
import { EdgeSiteLayout } from "@/components/edge-site/EdgeSiteLayout";
import { HomeFinalCTA } from "@/pages/HomePage.pricing";
import { contentPath, parseContentPath, type ContentLanguage } from "@/lib/contentLocale";
import { getFeature, localizeFeature } from "@/pages/features/featureData";
import { localizedArticles, contentAlternates, articlePath, articleJsonLd, collectionJsonLd, headingId, type Article } from "./articleData";
import { ArticleMarkdown } from "./ArticleMarkdown";
import { articleDate, topicKeys } from "./contentPresentation";
import { ResearchLinkSection } from "./ResearchLinkSection";
import "./content.css";

function ArticleCard({ article, language }: { article: Article; language: ContentLanguage }) {
  return <Link to={articlePath(article, language)} className="rounded-xl border eborder-06 ebg-glass-02 p-6 transition-colors hover:ebg-glass-04">
    <h3 className="text-lg font-semibold efg-heading">{article.title}</h3>
    <p className="mt-3 text-sm leading-relaxed efg-60">{article.description}</p>
  </Link>;
}

export function ContentPage({ includeMetadata = true }: { includeMetadata?: boolean }) {
  const location = useLocation();
  const route = parseContentPath(location.pathname);
  const available = route ? contentAlternates(route.collection, route.slug).map(entry => entry.language) : ["en"];
  return <PublicLocaleBoundary language={route?.language ?? "en"} availableLanguages={available}>
    <ContentPageBody includeMetadata={includeMetadata} />
  </PublicLocaleBoundary>;
}

function ContentPageBody({ includeMetadata }: { includeMetadata: boolean }) {
  const { slug } = useParams();
  const location = useLocation();
  const { i18n } = useTranslation();
  const { collection, language } = parseContentPath(location.pathname) ?? { collection: "guides", language: "en" };
  const t = i18n.getFixedT(language);
  const entries = localizedArticles(collection, language);
  const article = entries.find(entry => entry.slug === slug);
  const indexPath = contentPath(collection, language);
  if (slug && !article) return <EdgeSiteLayout><div className="container py-24"><h1 className="text-3xl">{t("content_not_found")}</h1><Link to={indexPath}>{t(`content_browse_${collection}`)}</Link></div></EdgeSiteLayout>;
  const collectionTitle = t(collection === "guides" ? "edge_nav_guides" : "edge_nav_research_articles");
  const title = article?.title ?? collectionTitle;
  const description = article?.description ?? t(`content_${collection}_description`);
  const url = `https://nanthai.tech${article ? articlePath(article, language) : indexPath}`;
  const headings = article ? [...article.body.matchAll(/^#{2,3} (.+)$/gm)].map(match => match[1].replace(/\*\*/g, "")) : [];
  const topics = [...new Set(entries.map(entry => entry.topic))];
  const more = entries.filter(entry => entry !== article).sort((a, b) => Number(b.topic === article?.topic) - Number(a.topic === article?.topic)).slice(0, 3);
  return <EdgeSiteLayout activePage={collection === "guides" ? "guides" : undefined}>
    {includeMetadata && <Seo title={`${title} | NanthAI`} description={description} url={url} type={article ? "article" : "website"} image={article?.image ? `https://nanthai.tech${article.image}` : undefined}>
      {contentAlternates(collection, article?.slug).map(alternate => <link key={alternate.language} rel="alternate" hrefLang={alternate.language} href={alternate.url} />)}
      <script type="application/ld+json">{JSON.stringify(article ? articleJsonLd(article, language) : collectionJsonLd(collection, language, collectionTitle, description)).replace(/</g, "\\u003c")}</script>
    </Seo>}
    <div className="edge-sans container pt-16 pb-20 md:pt-24">
      <nav aria-label={t("content_breadcrumbs")} className="mb-8 flex flex-wrap gap-2 text-sm efg-60">
        <Link to="/">{t("content_home")}</Link><span aria-hidden="true">/</span>
        {article ? <Link to={indexPath}>{collectionTitle}</Link> : <span aria-current="page">{collectionTitle}</span>}
        {article && <><span aria-hidden="true">/</span><span aria-current="page">{title}</span></>}
      </nav>
      {article ? <>
        <header className="mx-auto max-w-3xl">
          <Link to={indexPath} className="efg-60 text-sm underline underline-offset-4">{t(`content_all_${collection}`)}</Link>
          <h1 className="edge-display mt-6 text-[2.2rem] leading-[1.12] md:text-[3.2rem] efg-heading">{title}</h1>
          <p className="mt-6 text-sm efg-60">NanthAI · <time dateTime={article.published}>{articleDate(article.published, language)}</time>{article.updated !== article.published && <> · <time dateTime={article.updated}>{t("content_updated", { date: articleDate(article.updated, language) })}</time></>}</p>
          {article.image && <img src={article.image} alt={article.title} className="mt-8 w-full rounded-xl" width="1280" height="720" />}
        </header>
        <div className="mt-12 grid min-w-0 gap-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
          <aside className="hidden lg:block"><nav aria-label={t("content_toc")} className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto border-l eborder-06 pl-5 pr-3"><h2 className="efg-heading text-sm font-semibold">{t("content_on_this_page")}</h2><ul className="mt-5 space-y-3 text-sm efg-60">{headings.map(heading => <li key={heading}><a href={`#${headingId(heading)}`}>{heading}</a></li>)}</ul></nav></aside>
          <article id="main-content" lang={article.language} className="article-prose min-w-0 max-w-[72ch]"><ArticleMarkdown body={article.body} language={language} /></article>
        </div>
        <section className="mt-20" aria-label={t(`content_more_${collection}`)}><h2 className="edge-display text-2xl efg-heading">{t(`content_more_${collection}`)}</h2><div className="mt-6 grid gap-4 md:grid-cols-3">{more.map(entry => <ArticleCard key={entry.slug} article={entry} language={language} />)}</div></section>
      </> : <>
        <header id="main-content" className="max-w-3xl"><h1 className="edge-display text-[2.6rem] md:text-[3.6rem] efg-heading">{title}</h1><p className="mt-5 text-lg leading-relaxed efg-60">{description}</p></header>
        {topics.map(topic => <section key={topic} className="mt-14"><h2 className="edge-display text-2xl efg-heading">{t(topicKeys[topic], { defaultValue: topic })}</h2><div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{entries.filter(entry => entry.topic === topic).map(entry => <ArticleCard key={entry.slug} article={entry} language={language} />)}</div></section>)}
      </>}
    </div>
    {!article && collection === "guides" && <ResearchLinkSection language={language} />}
    {article?.collection === "research" && <section className="container edge-sans pb-16"><h2 className="edge-display text-2xl efg-heading">{t("content_related_features")}</h2><ul className="mt-5 flex flex-wrap gap-5 efg-70">{article.related.map(slug => {
      const feature = getFeature(slug);
      return <li key={slug}><Link className="underline underline-offset-4" to={`/features/${slug}`}>{feature ? localizeFeature(feature, t).title : slug}</Link></li>;
    })}</ul></section>}
    <HomeFinalCTA />
  </EdgeSiteLayout>;
}
