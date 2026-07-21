import { Helmet } from "react-helmet-async";

import { Seo } from "@/components/Seo";
import { EdgeSiteLayout } from "@/components/edge-site/EdgeSiteLayout";
import {
  buildBreadcrumbsJsonLd,
  buildOrganizationJsonLd,
  NANTHAI_SOCIALS,
} from "@/lib/seo";
import { StoreUrls } from "@/lib/constants";
import {
  HomeCapabilitiesSection,
  HomeHowItWorksSection,
  HomeIntegrationsSection,
} from "./HomePage.sections";
import { HomeHeroSection } from "./HomePage.hero";
import { HomeFinalCTA, HomePricingSection } from "./HomePage.pricing";
import { HomeWorkflowProofSection } from "./HomePage.proof";

export function HomePage() {
  return (
    <EdgeSiteLayout activePage="home">
      <Seo
        title="NanthAI Edge | AI Workspace"
        description="NanthAI Edge is the cross-platform AI workspace for 300+ models, research, AI skills, sandboxed analysis, and Word, Excel, and PowerPoint creation."
        url="https://nanthai.tech"
        canonical="https://nanthai.tech"
        image="https://nanthai.tech/apple-splash-1200x630.png"
        keywords={[
          "NanthAI Edge",
          "mobile AI workspace",
          "multi-model AI chat",
          "AI personas",
          "AI memory",
          "scheduled AI jobs",
          "OpenRouter mobile app",
          "AI app with integrations",
          "AI document generation",
          "AI spreadsheet generator",
          "AI presentation maker",
          "AI skills",
          "AI data analysis",
          "sandboxed code execution",
        ]}
      >
        <link rel="alternate" type="text/plain" href="https://nanthai.tech/llms.txt" />
        <link rel="alternate" type="text/markdown" href="https://nanthai.tech/llms/edge-home.md" />
      </Seo>

      <Helmet>
        <script type="application/ld+json">
          {JSON.stringify(
            buildOrganizationJsonLd({
              name: "NanthAI",
              url: "https://nanthai.tech",
              logoUrl: "https://nanthai.tech/apple-touch-icon.png",
              sameAs: NANTHAI_SOCIALS,
            }),
          )}
        </script>
        <script type="application/ld+json">
          {JSON.stringify(
            buildBreadcrumbsJsonLd([{ name: "Home", url: "https://nanthai.tech/" }]),
          )}
        </script>
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "MobileApplication",
            name: "NanthAI Edge",
            operatingSystem: "iOS, Android",
            applicationCategory: "ProductivityApplication",
            url: "https://nanthai.tech",
            image: "https://nanthai.tech/apple-splash-1200x630.png",
            description:
              "AI workspace with 300+ models, research, AI skills, sandboxed analysis, connected tools, and Office file creation.",
            installUrl: [StoreUrls.ios, StoreUrls.android],
            offers: {
              "@type": "Offer",
              price: "0",
              priceCurrency: "USD",
            },
          })}
        </script>
      </Helmet>

      <HomeHeroSection />
      <HomeHowItWorksSection />
      <HomeWorkflowProofSection />
      <HomeCapabilitiesSection />
      <HomeIntegrationsSection />
      <HomePricingSection />
      <HomeFinalCTA />
    </EdgeSiteLayout>
  );
}
