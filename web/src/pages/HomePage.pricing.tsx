import { ArrowRight, Check, Globe } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@clerk/react";
import { useTranslation } from "react-i18next";

import { captureCtaClick, ctaAuthState } from "@/lib/ctaAnalytics";
import { StoreUrls } from "@/lib/constants";
import { getFreeFeatures, getProFeatures } from "./HomePage.data";

// ── Pricing ─────────────────────────────────────────────────────────

export function HomePricingSection() {
  const { t } = useTranslation();
  const { isLoaded, isSignedIn } = useAuth();
  const freeFeatures = getFreeFeatures(t);
  const proFeatures = getProFeatures(t);
  const appHref = isLoaded && isSignedIn ? "/app" : "/sign-in";
  const authState = ctaAuthState(isLoaded, isSignedIn);
  const freeCtaLabel = isLoaded && isSignedIn ? t("home_go_to_app") : t("edge_start_free");
  const proCtaLabel = isLoaded && isSignedIn ? t("home_go_to_app") : t("edge_start_free_upgrade_later");

  const capturePricingCta = (location: "pricing_free" | "pricing_pro", label: string) => {
    captureCtaClick({
      location,
      label,
      destination: appHref,
      authState,
    });
  };

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
              <span className="edge-accent">{t("home_pricing_heading_line2")}</span>
            </h2>
          </div>
          <p className="edge-fade-up edge-stagger-3 edge-sans max-w-xl text-[0.95rem] font-light leading-[1.8] efg-55 lg:text-right">
            {t("home_pricing_desc")}
          </p>
        </div>

        <div className="mt-16 grid gap-4 lg:grid-cols-2">
          {/* Free tier */}
          <div className="edge-card edge-card-lift edge-hover-glow rounded-2xl p-8 md:p-10">
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
            <Link
              to={appHref}
              aria-disabled={!isLoaded}
              onClick={(event) => {
                if (!isLoaded) {
                  event.preventDefault();
                  return;
                }
                capturePricingCta("pricing_free", freeCtaLabel);
              }}
              className={`mt-8 inline-flex items-center gap-2 rounded-full eborder-08 border px-5 py-3 text-[0.82rem] font-medium efg-60 transition-colors hover:efg-heading ${!isLoaded ? "pointer-events-none opacity-60" : ""}`}
            >
              {freeCtaLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Pro tier */}
          <div
            className="edge-card edge-card-lift edge-hover-glow relative rounded-2xl p-8 md:p-10"
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
                    <Check className="h-2 w-2 edge-accent" />
                  </div>
                  <span className="edge-sans text-[0.82rem] font-light leading-relaxed efg-65">
                    {feature}
                  </span>
                </li>
              ))}
            </ul>
            <Link
              to={appHref}
              aria-disabled={!isLoaded}
              onClick={(event) => {
                if (!isLoaded) {
                  event.preventDefault();
                  return;
                }
                capturePricingCta("pricing_pro", proCtaLabel);
              }}
              className={`ecta mt-8 inline-flex items-center gap-2 rounded-full px-5 py-3 text-[0.82rem] font-medium ${!isLoaded ? "pointer-events-none opacity-60" : ""}`}
            >
              {proCtaLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
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

export function HomeFinalCTA() {
  const { t } = useTranslation();
  const { isLoaded, isSignedIn } = useAuth();
  const appHref = isLoaded && isSignedIn ? "/app" : "/sign-in";
  const appLabel = isLoaded && isSignedIn ? t("home_go_to_app") : t("home_get_started_free");
  const authState = ctaAuthState(isLoaded, isSignedIn);

  return (
    <section className="relative">
      <div className="edge-gradient-line-accent" />

      <div className="container py-24 md:py-36">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="edge-display text-[clamp(2.4rem,5vw,4.5rem)] efg-heading">
            {t("home_cta_heading_line1")}
            <br />
            <span className="edge-accent">{t("home_cta_heading_line2")}</span>
          </h2>
          <p className="edge-sans mx-auto mt-8 max-w-lg text-[0.95rem] font-light leading-[1.8] efg-55">
            {t("home_cta_desc")}
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              to={appHref}
              aria-disabled={!isLoaded}
              onClick={(event) => {
                if (!isLoaded) {
                  event.preventDefault();
                  return;
                }
                captureCtaClick({
                  location: "home_final",
                  label: appLabel,
                  destination: appHref,
                  authState,
                });
              }}
              className={`ecta group relative inline-flex items-center gap-2.5 rounded-full px-8 py-4 text-[0.92rem] font-medium transition-all ${!isLoaded ? "pointer-events-none opacity-60" : ""}`}
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
