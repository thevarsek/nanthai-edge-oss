export interface OrganizationInfo {
  name: string;
  url: string;
  logoUrl: string;
  sameAs?: string[];
}

export function buildOrganizationJsonLd(org: OrganizationInfo) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: org.name,
    url: org.url,
    logo: {
      "@type": "ImageObject",
      url: org.logoUrl,
    },
    ...(org.sameAs && org.sameAs.length ? { sameAs: org.sameAs } : {}),
  };
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function buildBreadcrumbsJsonLd(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export const NANTHAI_SOCIALS: string[] = [
  "https://x.com/nanth_ai",
  "https://www.facebook.com/profile.php?id=61576915574765",
  "https://www.instagram.com/nanth.ai/",
  "https://www.linkedin.com/company/107890980/",
];
