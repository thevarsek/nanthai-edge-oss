import {
  ArrowRight,
  Brain,
  CalendarClock,
  Check,
  Drama,
  FileStack,
  Globe,
  Key,
  Layers,
  LayoutGrid,
  Link2,
  MessagesSquare,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";

import { Seo } from "@/components/Seo";
import { EdgeSiteLayout } from "@/components/edge-site/EdgeSiteLayout";
import { HeroSpotlight } from "@/components/edge-site/HeroSpotlight";
import { HeroVantaNet } from "@/components/edge-site/HeroVantaNet";
import { HeroOutlineText } from "@/components/edge-site/HeroOutlineText";
import { buildBreadcrumbsJsonLd, buildOrganizationJsonLd } from "@/lib/seo";
import { StoreUrls } from "@/lib/constants";

// ── Data (functions accepting t) ────────────────────────────────────

function getHeadlinePoints(t: (k: string) => string) {
  return [
    t("home_chip_models"),
    t("home_chip_native"),
    t("home_chip_pro"),
    t("home_chip_tools"),
  ];
}

function getHowItWorksSteps(t: (k: string) => string) {
  return [
    {
      icon: Key,
      step: "01",
      title: t("home_hiw_step1_title"),
      body: t("home_hiw_step1_body"),
    },
    {
      icon: LayoutGrid,
      step: "02",
      title: t("home_hiw_step2_title"),
      body: t("home_hiw_step2_body"),
    },
    {
      icon: Zap,
      step: "03",
      title: t("home_hiw_step3_title"),
      body: t("home_hiw_step3_body"),
    },
  ];
}

function getCapabilityCards(t: (k: string) => string) {
  return [
    {
      icon: MessagesSquare,
      title: t("home_cap_chat_title"),
      body: t("home_cap_chat_body"),
      detail: t("free"),
    },
    {
      icon: Drama,
      title: t("home_cap_personas_title"),
      body: t("home_cap_personas_body"),
      detail: t("pro_2"),
    },
    {
      icon: Brain,
      title: t("home_cap_memory_title"),
      body: t("home_cap_memory_body"),
      detail: t("pro_2"),
    },
    {
      icon: Globe,
      title: t("home_cap_search_title"),
      body: t("home_cap_search_body"),
      detail: t("home_cap_free_pro"),
    },
    {
      icon: CalendarClock,
      title: t("home_cap_jobs_title"),
      body: t("home_cap_jobs_body"),
      detail: t("pro_2"),
    },
    {
      icon: Zap,
      title: t("home_cap_auto_title"),
      body: t("home_cap_auto_body"),
      detail: t("pro_2"),
    },
    {
      icon: FileStack,
      title: t("home_cap_files_title"),
      body: t("home_cap_files_body"),
      detail: t("home_cap_free_pro"),
    },
    {
      icon: Layers,
      title: t("home_cap_ideascapes_title"),
      body: t("home_cap_ideascapes_body"),
      detail: t("pro_2"),
    },
  ];
}

function getIntegrations(t: (k: string) => string) {
  return [
    {
      name: t("home_int_google_name"),
      services: [t("home_int_google_s1"), t("home_int_google_s2"), t("home_int_google_s3")],
      body: t("home_int_google_coming_soon_body"),
      statusLabel: t("home_int_status_coming_soon"),
    },
    {
      name: t("home_int_ms_name"),
      services: [t("home_int_ms_s1"), t("home_int_ms_s2"), t("home_int_ms_s3")],
      body: t("home_int_ms_body"),
    },
    {
      name: t("home_int_notion_name"),
      services: [t("home_int_notion_s1"), t("home_int_notion_s2")],
      body: t("home_int_notion_body"),
    },
    {
      name: t("home_int_apple_name"),
      services: [t("home_int_apple_s1")],
      body: t("home_int_apple_body"),
    },
  ];
}

function getFreeFeatures(t: (k: string) => string) {
  return [
    t("home_free_1"),
    t("home_free_2"),
    t("home_free_3"),
    t("home_free_4"),
    t("home_free_5"),
    t("home_free_6"),
    t("home_free_7"),
    t("home_free_8"),
    t("home_free_9"),
    t("home_free_10"),
  ];
}

function getProFeatures(t: (k: string) => string) {
  return [
    t("home_pro_1"),
    t("home_pro_2"),
    t("home_pro_3"),
    t("home_pro_4"),
    t("home_pro_5"),
    t("home_pro_6"),
    t("home_pro_7"),
    t("home_pro_8"),
    t("home_pro_9"),
    t("home_pro_10"),
    t("home_pro_11"),
    t("home_pro_12"),
  ];
}

// ── Page shell ──────────────────────────────────────────────────────

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
      <HomeCapabilitiesSection />
      <HomeIntegrationsSection />
      <HomePricingSection />
      <HomeFinalCTA />
    </EdgeSiteLayout>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────

function HomeHeroSection() {
  const { t } = useTranslation();
  const { isSignedIn } = useAuth();
  const appHref = isSignedIn ? "/app" : "/sign-in";
  const appLabel = isSignedIn ? t("home_go_to_app") : t("home_get_started_free");
  const hero2Ref = useRef<HTMLDivElement>(null);
  const [hero2Visible, setHero2Visible] = useState(false);

  useEffect(() => {
    const el = hero2Ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setHero2Visible(true); observer.disconnect(); } },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const vis = hero2Visible ? "is-visible" : "";
  const headlinePoints = getHeadlinePoints(t);

  return (
      <div className="relative">
        {/* Two Vanta nets stacked — orange masked to top, teal masked to bottom. */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div
            className="absolute inset-0"
            style={{
              WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 30%, transparent 65%)",
              maskImage: "linear-gradient(to bottom, black 0%, black 30%, transparent 65%)",
            }}
          >
            <HeroVantaNet color={0xff6b3d} opacity={0.25} />
          </div>
          <div
            className="absolute inset-0"
            style={{
              WebkitMaskImage: "linear-gradient(to bottom, transparent 35%, black 70%, black 100%)",
              maskImage: "linear-gradient(to bottom, transparent 35%, black 70%, black 100%)",
            }}
          >
            <HeroVantaNet color={0x00e0d0} opacity={0.2} />
          </div>
        </div>

        {/* Screen 1 — solid, left-aligned */}
        <section className="relative flex min-h-[100vh] items-center">
          <HeroSpotlight color="255, 107, 61" size={800} opacity={0.08} />

          <div className="container relative">
            <h1 className="edge-display-xl edge-materialize uppercase text-[clamp(3.5rem,11vw,10rem)] efg-heading">
              {t("home_hero1_line1")}
              <br />
              {t("home_hero1_line2")}<span className="text-[#FF6B3D]">.</span>
            </h1>
          </div>
        </section>

        {/* Screen 2 — outline, right-aligned */}
        <section ref={hero2Ref} className="relative flex min-h-[100vh] items-center">
          <HeroSpotlight color="0, 224, 208" size={800} opacity={0.07} />

        <div className="container relative">
          <div className={`edge-materialize-scroll ${vis}`}>
            <HeroOutlineText
              lines={[
                [{ text: t("home_hero2_line1_pre") }, { text: t("home_hero2_line1_accent"), accent: true }],
                [{ text: t("home_hero2_line2_pre") }, { text: t("home_hero2_line2_accent"), accent: true }, { text: ".", accent: true }],
              ]}
              align="right"
              strokeWidth={2}
              className="w-full"
            />
          </div>

          <div className="ml-auto mt-12 max-w-xl text-right">
            <p className={`edge-sans edge-materialize-scroll edge-mat-delay-1 ${vis} text-[1.05rem] font-light leading-[1.75] efg-60`}>
              {t("home_hero2_desc")}
            </p>

            <div className={`edge-materialize-scroll edge-mat-delay-2 ${vis} mt-8 flex flex-wrap items-center justify-end gap-2.5`}>
              {headlinePoints.map((point) => (
                <span
                  key={point}
                  className="edge-chip rounded-full px-3.5 py-1.5 text-[0.75rem]"
                >
                  {point}
                </span>
              ))}
            </div>

            <div className={`edge-materialize-scroll edge-mat-delay-3 ${vis} mt-8 flex flex-col items-end gap-5`}>
              <Link
                to={appHref}
                className="group relative inline-flex items-center gap-2.5 rounded-full ecta px-8 py-4 text-[0.92rem] font-medium transition-all"
              >
                {appLabel}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>

              {/* Official store badges — Apple first per App Store guidelines */}
              <div className="flex items-center gap-3">
                <a href={StoreUrls.ios} target="_blank" rel="noreferrer" aria-label="Download on the App Store" className="transition-opacity hover:opacity-80">
                  <img
                    src="/edge-brand/download-on-app-store.svg"
                    alt="Download on the App Store"
                    className="h-[40px] w-auto"
                  />
                </a>
                <a href={StoreUrls.android} target="_blank" rel="noreferrer" aria-label="Get it on Google Play" className="transition-opacity hover:opacity-80">
                  <img
                    src="/edge-brand/get-it-on-google-play.png"
                    alt="Get it on Google Play"
                    className="h-[60px] w-auto"
                  />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
      </div>
  );
}

// ── How it works (BYOK) ─────────────────────────────────────────────

function HomeHowItWorksSection() {
  const { t } = useTranslation();
  const howItWorksSteps = getHowItWorksSteps(t);

  return (
    <section className="relative">
      <div className="edge-gradient-line-accent" />

      <div className="container py-24 md:py-36">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-end">
          <div>
            <div className="edge-fade-up edge-stagger-1 edge-section-rule mb-8 max-w-xs">
              <span className="edge-label efg-25">{t("home_hiw_label")}</span>
            </div>
            <h2 className="edge-display edge-fade-up edge-stagger-2 text-[clamp(2.4rem,5vw,4.5rem)] efg-heading">
              {t("home_hiw_heading_line1")}
              <br />
              <span className="text-[#FF6B3D]">{t("home_hiw_heading_line2")}</span>
            </h2>
          </div>
          <p className="edge-fade-up edge-stagger-3 edge-sans max-w-xl text-[0.95rem] font-light leading-[1.8] efg-55 lg:text-right">
            {t("home_hiw_desc")}
          </p>
        </div>

        <div className="mt-16 grid gap-3 md:grid-cols-3">
          {howItWorksSteps.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.step}
                className="edge-card edge-card-lift edge-hover-glow group rounded-2xl p-7 md:p-8"
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl eborder-05 border ebg-glass-02">
                    <Icon className="h-[18px] w-[18px] efg-50" />
                  </div>
                  <span className="edge-mono text-[0.65rem] efg-15">
                    {item.step}
                  </span>
                </div>
                <h3 className="edge-sans mt-6 text-[1.05rem] font-medium tracking-[-0.01em] efg-85">
                  {item.title}
                </h3>
                <p className="edge-sans mt-3 text-[0.88rem] font-light leading-[1.7] efg-55">
                  {item.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Capabilities ────────────────────────────────────────────────────

function HomeCapabilitiesSection() {
  const { t } = useTranslation();
  const capabilityCards = getCapabilityCards(t);

  return (
    <section className="relative">
      <div className="edge-gradient-line" />

      <div className="container py-24 md:py-36">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-end">
          <div>
            <div className="edge-fade-up edge-stagger-1 edge-section-rule mb-8 max-w-xs">
              <span className="edge-label efg-25">{t("home_cap_label")}</span>
            </div>
            <h2 className="edge-display edge-fade-up edge-stagger-2 text-[clamp(2.4rem,5vw,4.5rem)] efg-heading">
              {t("home_cap_heading_line1")}
              <br />
              <span className="text-[#FF6B3D]">{t("home_cap_heading_line2")}</span>
            </h2>
          </div>
          <p className="edge-fade-up edge-stagger-3 edge-sans max-w-xl text-[0.95rem] font-light leading-[1.8] efg-55 lg:text-right">
            {t("home_cap_desc")}
          </p>
        </div>

        <div className="mt-16 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {capabilityCards.map((item, index) => {
            const Icon = item.icon;
            return (
              <div
                key={index}
                className="edge-card edge-card-lift edge-hover-glow group rounded-2xl p-7 md:p-8"
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl eborder-05 border ebg-glass-02">
                    <Icon className="h-[18px] w-[18px] efg-50" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full eborder-06 border ebg-glass-03 px-2 py-0.5 text-[0.55rem] font-medium uppercase tracking-[0.1em] efg-25">
                      {item.detail}
                    </span>
                    <span className="edge-mono text-[0.65rem] efg-15">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                </div>
                <h3 className="edge-sans mt-6 text-[1.05rem] font-medium tracking-[-0.01em] efg-85">
                  {item.title}
                </h3>
                <p className="edge-sans mt-3 text-[0.84rem] font-light leading-[1.7] efg-55">
                  {item.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Integrations ────────────────────────────────────────────────────

function HomeIntegrationsSection() {
  const { t } = useTranslation();
  const integrations = getIntegrations(t);

  return (
    <section className="relative">
      <div className="edge-gradient-line-accent" />

      <div className="container py-24 md:py-36">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-end">
          <div>
            <div className="edge-fade-up edge-stagger-1 edge-section-rule mb-8 max-w-xs">
              <span className="edge-label efg-25">{t("home_int_label")}</span>
            </div>
            <h2 className="edge-display edge-fade-up edge-stagger-2 text-[clamp(2.4rem,5vw,4.5rem)] efg-heading">
              {t("home_int_heading_line1")}
              <br />
              <span className="text-[#FF6B3D]">{t("home_int_heading_line2")}</span>
            </h2>
          </div>
          <p className="edge-fade-up edge-stagger-3 edge-sans max-w-xl text-[0.95rem] font-light leading-[1.8] efg-55 lg:text-right">
            {t("home_int_desc")}
          </p>
        </div>

        <div className="mt-16 grid gap-3 md:grid-cols-2">
          {integrations.map((item) => (
            <div
              key={item.name}
              className="edge-card edge-card-lift edge-hover-glow group rounded-2xl p-7 md:p-8"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="edge-sans text-[1.05rem] font-medium tracking-[-0.01em] efg-85">
                    {item.name}
                  </h3>
                  {"statusLabel" in item && item.statusLabel ? (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-amber-700 dark:border-amber-400/30 dark:text-amber-300">
                      {item.statusLabel}
                    </span>
                  ) : null}
                </div>
                <Link2 className="h-4 w-4 efg-15" />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {item.services.map((s) => (
                  <span
                    key={s}
                    className="edge-chip rounded-full px-2.5 py-1 text-[0.7rem]"
                  >
                    {s}
                  </span>
                ))}
              </div>
              <p className="edge-sans mt-4 text-[0.84rem] font-light leading-[1.7] efg-55">
                {item.body}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-sm efg-45">
          {t("home_int_google_coming_soon_note")}
        </p>

        <p className="edge-sans mt-8 text-center text-[0.82rem] font-light efg-30">
          {t("home_int_footer")}
        </p>
      </div>
    </section>
  );
}

// ── Pricing ─────────────────────────────────────────────────────────

function HomePricingSection() {
  const { t } = useTranslation();
  const freeFeatures = getFreeFeatures(t);
  const proFeatures = getProFeatures(t);

  return (
    <section className="relative">
      <div className="edge-gradient-line" />

      <div className="container py-24 md:py-36">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-end">
          <div>
            <div className="edge-fade-up edge-stagger-1 edge-section-rule mb-8 max-w-xs">
              <span className="edge-label efg-25">{t("home_pricing_label")}</span>
            </div>
            <h2 className="edge-display edge-fade-up edge-stagger-2 text-[clamp(2.4rem,5vw,4.5rem)] efg-heading">
              {t("home_pricing_heading_line1")}
              <br />
              <span className="text-[#FF6B3D]">{t("home_pricing_heading_line2")}</span>
            </h2>
          </div>
          <p className="edge-fade-up edge-stagger-3 edge-sans max-w-xl text-[0.95rem] font-light leading-[1.8] efg-55 lg:text-right">
            {t("home_pricing_desc")}
          </p>
        </div>

        <div className="mt-16 grid gap-4 lg:grid-cols-2">
          {/* Free tier */}
          <div className="edge-card rounded-2xl p-8 md:p-10">
            <div className="flex items-center justify-between">
              <div>
                <span className="edge-label efg-25">{t("free")}</span>
                <p className="edge-display mt-2 text-[clamp(2rem,3.5vw,2.8rem)] efg-heading">
                  £0
                </p>
              </div>
              <span className="edge-mono text-[0.7rem] efg-15">{t("home_pricing_forever")}</span>
            </div>
            <p className="edge-sans mt-4 text-[0.88rem] font-light leading-[1.7] efg-50">
              {t("home_pricing_free_desc")}
            </p>
            <ul className="mt-8 space-y-3">
              {freeFeatures.map((feature, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <div className="mt-1 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full eborder-08 border">
                    <Check className="h-2 w-2 efg-35" />
                  </div>
                  <span className="edge-sans text-[0.82rem] font-light leading-relaxed efg-55">
                    {feature}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Pro tier */}
          <div
            className="relative rounded-2xl eborder-06 border p-8 md:p-10"
            style={{
              background:
                "linear-gradient(180deg, rgba(0,224,208,0.03) 0%, rgba(255,107,61,0.02) 100%)",
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="edge-label efg-25">{t("pro_2")}</span>
                  <span className="rounded-full eborder-06 border ebg-glass-03 px-2.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-[0.12em] efg-30">
                    {t("home_pricing_one_time")}
                  </span>
                </div>
                <p className="edge-display mt-2 text-[clamp(2rem,3.5vw,2.8rem)] efg-heading">
                  £4.99
                </p>
              </div>
              <span className="edge-mono text-[0.7rem] efg-15">{t("home_pricing_forever")}</span>
            </div>
            <p className="edge-sans mt-4 text-[0.88rem] font-light leading-[1.7] efg-50">
              {t("home_pricing_pro_desc")}
            </p>
            <ul className="mt-8 space-y-3">
              {proFeatures.map((feature, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <div className="mt-1 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full bg-[#FF6B3D]/25">
                    <Check className="h-2 w-2 text-[#FF6B3D]" />
                  </div>
                  <span className="edge-sans text-[0.82rem] font-light leading-relaxed efg-65">
                    {feature}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* BYOK explainer */}
        <div className="edge-card mt-4 rounded-2xl p-8 md:p-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_1.5fr] lg:items-start">
            <div>
              <Globe className="h-6 w-6 efg-20" />
              <h3 className="edge-display mt-4 text-[clamp(1.6rem,3vw,2.2rem)] efg-heading">
                {t("home_byok_title")}
              </h3>
            </div>
            <div className="edge-sans space-y-4 text-[0.88rem] font-light leading-[1.7] efg-55">
              <p>{t("home_byok_body1")}</p>
              <p>{t("home_byok_body2")}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Final CTA ───────────────────────────────────────────────────────

function HomeFinalCTA() {
  const { t } = useTranslation();
  const { isSignedIn } = useAuth();
  const appHref = isSignedIn ? "/app" : "/sign-in";
  const appLabel = isSignedIn ? t("home_go_to_app") : t("home_get_started_free");

  return (
    <section className="relative">
      <div className="edge-gradient-line-accent" />

      <div className="container py-24 md:py-36">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="edge-display text-[clamp(2.4rem,5vw,4.5rem)] efg-heading">
            {t("home_cta_heading_line1")}
            <br />
            <span className="text-[#FF6B3D]">{t("home_cta_heading_line2")}</span>
          </h2>
          <p className="edge-sans mx-auto mt-8 max-w-lg text-[0.95rem] font-light leading-[1.8] efg-55">
            {t("home_cta_desc")}
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              to={appHref}
              className="ecta group relative inline-flex items-center gap-2.5 rounded-full px-8 py-4 text-[0.92rem] font-medium transition-all"
            >
              {appLabel}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <a href={StoreUrls.ios} target="_blank" rel="noreferrer" aria-label="Download on the App Store" className="transition-opacity hover:opacity-80">
              <img
                src="/edge-brand/download-on-app-store.svg"
                alt="Download on the App Store"
                className="h-[40px] w-auto"
              />
            </a>
            <a href={StoreUrls.android} target="_blank" rel="noreferrer" aria-label="Get it on Google Play" className="transition-opacity hover:opacity-80">
              <img
                src="/edge-brand/get-it-on-google-play.png"
                alt="Get it on Google Play"
                className="h-[60px] w-auto"
              />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
