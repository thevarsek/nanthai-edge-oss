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

export const NANTHAI_SOCIAL_LINKS = [
  { destination: "x", label: "X", url: "https://x.com/nanth_ai" },
  { destination: "facebook", label: "Facebook", url: "https://www.facebook.com/profile.php?id=61576915574765" },
  { destination: "instagram", label: "Instagram", url: "https://www.instagram.com/nanth.ai/" },
  { destination: "linkedin", label: "LinkedIn", url: "https://www.linkedin.com/company/107890980/" },
] as const;

export const NANTHAI_SOCIALS: string[] = NANTHAI_SOCIAL_LINKS.map((social) => social.url);
