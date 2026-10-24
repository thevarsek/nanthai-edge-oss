import { ResearchLinkSection } from "./content/ResearchLinkSection";
import { brandSchemas } from "@/lib/brandSchema";
import { HomeWorkflowSection } from "./workflows/HomeWorkflowSection";
import { Seo } from "@/components/Seo";
import { EdgeSiteLayout } from "@/components/edge-site/EdgeSiteLayout";
import {
  buildBreadcrumbsJsonLd,
} from "@/lib/seo";
import { StoreUrls } from "@/lib/constants";
import { useTranslation } from "react-i18next";
import {
  HomeCapabilitiesSection,
  HomeHowItWorksSection,
  HomeIntegrationsSection,
} from "./HomePage.sections";
import { HomeHeroSection } from "./HomePage.hero";
import { HomeFinalCTA, HomePricingSection } from "./HomePage.pricing";
import { HomeWorkflowProofSection } from "./HomePage.proof";

export function HomePage() {
  const { t, i18n } = useTranslation();

  return (
    <EdgeSiteLayout activePage="home">
      <Seo
        title={t("home_seo_title")}
        description={t("home_seo_desc")}
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

      <>
        {brandSchemas.map(schema => <script key={schema["@type"]} type="application/ld+json">{JSON.stringify(schema)}</script>)}
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
            inLanguage: i18n.resolvedLanguage ?? i18n.language,
            operatingSystem: "iOS, Android",
            applicationCategory: "ProductivityApplication",
            url: "https://nanthai.tech",
            image: "https://nanthai.tech/apple-splash-1200x630.png",
            description: t("home_structured_data_desc"),
            installUrl: [StoreUrls.ios, StoreUrls.android],
            offers: {
              "@type": "Offer",
              price: "0",
              priceCurrency: "USD",
            },
          })}
        </script>
      </>

      <HomeHeroSection />
      <HomeHowItWorksSection />
      <HomeWorkflowProofSection />
      <HomeCapabilitiesSection />
      <HomeIntegrationsSection />
      <HomeWorkflowSection />
      <ResearchLinkSection />
      <HomePricingSection />
      <HomeFinalCTA />
    </EdgeSiteLayout>
  );
}
