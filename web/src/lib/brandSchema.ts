import { buildOrganizationJsonLd, NANTHAI_SOCIALS } from "./seo";
import { StoreUrls } from "./constants";

export const brandSchemas = [
  buildOrganizationJsonLd({
    name: "NanthAI", alternateName: ["NanthAI Edge", "Nanthai"],
    url: "https://nanthai.tech/", logoUrl: "https://nanthai.tech/apple-touch-icon.png",
    sameAs: [...NANTHAI_SOCIALS, "https://github.com/thevarsek/nanthai-edge-oss", StoreUrls.ios, StoreUrls.android],
  }),
  {
    "@context": "https://schema.org", "@type": "WebSite", name: "NanthAI",
    alternateName: ["NanthAI Edge", "Nanthai"], url: "https://nanthai.tech/",
    logo: "https://nanthai.tech/apple-touch-icon.png",
    sameAs: ["https://www.linkedin.com/company/nanthai/", "https://github.com/thevarsek/nanthai-edge-oss", StoreUrls.ios, StoreUrls.android],
    publisher: { "@type": "Organization", name: "NanthAI", url: "https://nanthai.tech/" },
  },
];
