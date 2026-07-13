import { Helmet } from "react-helmet-async";

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
  const canonicalUrl = canonical ?? url;

  return (
    <Helmet>
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
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />

      {children}
    </Helmet>
  );
}
