import { Helmet } from "react-helmet-async";

import { Seo } from "@/components/Seo";
import { EdgeSiteLayout } from "@/components/edge-site/EdgeSiteLayout";
import { buildBreadcrumbsJsonLd, buildOrganizationJsonLd } from "@/lib/seo";
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
        description="NanthAI Edge is the native mobile AI workspace with multi-model chat, personas, search, files, scheduled jobs, and connected tools."
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
              "AI workspace with multi-model chat, personas, memory, scheduled jobs, search, files, and connected tools.",
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
