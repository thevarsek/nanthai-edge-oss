import { Link } from "react-router-dom";
import { articles, articlePath } from "./articleData";

export function RelatedGuides({ feature }: { feature: string }) {
  const related = articles.filter(article => article.collection === "guides" && article.related.includes(feature));
  if (!related.length) return null;
  return <section className="container pb-16 edge-sans" aria-label="Related guides">
    <h2 className="edge-display text-2xl efg-heading">Related guides</h2>
    <ul className="mt-5 space-y-3 efg-70">{related.map(article => <li key={article.slug}>Guide: <Link className="underline underline-offset-4" to={articlePath(article)}>{article.title}</Link></li>)}</ul>
  </section>;
}

