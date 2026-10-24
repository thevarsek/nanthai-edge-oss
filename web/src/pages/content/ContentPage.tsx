import { Link, useLocation, useParams } from "react-router-dom";
import { Seo } from "@/components/Seo";
import { EdgeSiteLayout } from "@/components/edge-site/EdgeSiteLayout";
import { HomeFinalCTA } from "@/pages/HomePage.pricing";
import { articles, articlePath, articleJsonLd, collectionJsonLd, collectionDescriptions, collectionTitles, headingId, type Article, type Collection } from "./articleData";
import { ArticleMarkdown } from "./ArticleMarkdown";
import "./content.css";

function ArticleCard({ article }: { article: Article }) {
  return <Link to={articlePath(article)} className="rounded-xl border eborder-06 ebg-glass-02 p-6 transition-colors hover:ebg-glass-04">
    <h3 className="text-lg font-semibold efg-heading">{article.title}</h3>
    <p className="mt-3 text-sm leading-relaxed efg-60">{article.description}</p>
  </Link>;
}

export function ContentPage({ includeMetadata = true }: { includeMetadata?: boolean }) {
  const { slug } = useParams();
  const location = useLocation();
  const collection: Collection = location.pathname.startsWith("/research") ? "research" : "guides";
  const entries = articles.filter(article => article.collection === collection);
  const article = entries.find(entry => entry.slug === slug);
  if (slug && !article) return <EdgeSiteLayout><div className="container py-24"><h1 className="text-3xl">Article not found</h1><Link to={`/${collection}`}>Browse {collection}</Link></div></EdgeSiteLayout>;
  const title = article?.title ?? collectionTitles[collection];
  const description = article?.description ?? collectionDescriptions[collection];
  const url = `https://nanthai.tech/${collection}${article ? `/${article.slug}` : ""}`;
  const headings = article ? [...article.body.matchAll(/^#{2,3} (.+)$/gm)].map(match => match[1].replace(/\*\*/g, "")) : [];
  const topics = [...new Set(entries.map(entry => entry.topic))];
  const more = entries.filter(entry => entry !== article).sort((a, b) => Number(b.topic === article?.topic) - Number(a.topic === article?.topic)).slice(0, 3);
  return <EdgeSiteLayout activePage={collection === "guides" ? "guides" : undefined}>
    {includeMetadata && <Seo title={`${title} | NanthAI`} description={description} url={url} type={article ? "article" : "website"} image={article?.image ? `https://nanthai.tech${article.image}` : undefined}>
      <script type="application/ld+json">{JSON.stringify(article ? articleJsonLd(article) : collectionJsonLd(collection)).replace(/</g, "\\u003c")}</script>
    </Seo>}
    <div className="edge-sans container pt-16 pb-20 md:pt-24">
      {article ? <>
        <header className="mx-auto max-w-3xl">
          <Link to={`/${collection}`} className="efg-60 text-sm underline underline-offset-4">All {collection}</Link>
          <h1 className="edge-display mt-6 text-[2.2rem] leading-[1.12] md:text-[3.2rem] efg-heading">{title}</h1>
          <p className="mt-6 text-sm efg-60">NanthAI · <time dateTime={article.published}>{new Date(`${article.published}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</time>{article.updated !== article.published ? ` · Updated ${article.updated}` : ""}</p>
          {article.image && <img src={article.image} alt={article.title} className="mt-8 w-full rounded-xl" width="1280" height="720" />}
        </header>
        <div className="mt-12 grid min-w-0 gap-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
          <aside className="hidden lg:block"><nav aria-label="Table of contents" className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto border-l eborder-06 pl-5 pr-3"><h2 className="efg-heading text-sm font-semibold">On this page</h2><ul className="mt-5 space-y-3 text-sm efg-60">{headings.map(heading => <li key={heading}><a href={`#${headingId(heading)}`}>{heading}</a></li>)}</ul></nav></aside>
          <article id="main-content" className="article-prose min-w-0 max-w-[72ch]"><ArticleMarkdown body={article.body} /></article>
        </div>
        <section className="mt-20" aria-label={`More ${collection}`}><h2 className="edge-display text-2xl efg-heading">More {collection}</h2><div className="mt-6 grid gap-4 md:grid-cols-3">{more.map(entry => <ArticleCard key={entry.slug} article={entry} />)}</div></section>
      </> : <>
        <header id="main-content" className="max-w-3xl"><h1 className="edge-display text-[2.6rem] md:text-[3.6rem] efg-heading">{title}</h1><p className="mt-5 text-lg leading-relaxed efg-60">{description}</p></header>
        {topics.map(topic => <section key={topic} className="mt-14"><h2 className="edge-display text-2xl efg-heading">{topic}</h2><div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{entries.filter(entry => entry.topic === topic).map(entry => <ArticleCard key={entry.slug} article={entry} />)}</div></section>)}
      </>}
    </div>
    {article?.collection === "research" && <section className="container edge-sans pb-16"><h2 className="edge-display text-2xl efg-heading">Related features</h2><ul className="mt-5 flex flex-wrap gap-5 efg-70">{article.related.map(feature => <li key={feature}><Link className="underline underline-offset-4" to={`/features/${feature}`}>{feature.split("-").map(word => word[0].toUpperCase() + word.slice(1)).join(" ")}</Link></li>)}</ul></section>}
    <HomeFinalCTA />
  </EdgeSiteLayout>;
}
