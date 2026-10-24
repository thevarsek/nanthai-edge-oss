import { useTranslation } from "react-i18next";
import { contentLanguage, parseContentPath } from "@/lib/contentLocale";
import { parsePublicPath, publicPath, publicAlternates } from "@/lib/publicLocale";

type SeoProps = {
  title: string;
  description: string;
  url: string;
  image?: string;
  keywords?: string[] | string;
  type?: string;
  canonical?: string;
  children?: React.ReactNode;
};

export function Seo({
  title,
  description,
  url,
  image = "https://nanthai.tech/apple-splash-1200x630.png",
  keywords,
  type = "website",
  canonical,
  children,
}: SeoProps) {
  const keywordsStr = Array.isArray(keywords) ? keywords.join(", ") : keywords;
  const { i18n } = useTranslation();
  const language = contentLanguage(i18n.resolvedLanguage ?? i18n.language);
  const originalCanonical = canonical ?? url;
  const path = new URL(originalCanonical).pathname;
  const marketing = parsePublicPath(path) && !parseContentPath(path);
  const canonicalUrl = marketing ? `https://nanthai.tech${publicPath(path, language)}` : originalCanonical;
  const pageUrl = marketing ? canonicalUrl : url;

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      {keywordsStr && <meta name="keywords" content={keywordsStr} />}
      <meta
        name="robots"
        content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
      />
      <link rel="canonical" href={canonicalUrl} />

      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={type} />
      <meta property="og:url" content={pageUrl} />
      <meta property="og:image" content={image} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />

      {marketing && <>
        {publicAlternates(path).map(alternate => <link key={alternate.language} rel="alternate" hrefLang={alternate.language} href={alternate.url} />)}
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org", "@type": "WebPage", name: title,
          description, url: canonicalUrl, inLanguage: language,
          isPartOf: { "@type": "WebSite", name: "NanthAI", url: "https://nanthai.tech/" },
        }).replaceAll("<", "\\u003c")}</script>
      </>}
      {children}
    </>
  );
}
