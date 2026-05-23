import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@clerk/react";
import { useTranslation } from "react-i18next";

import { HeroSpotlight } from "@/components/edge-site/HeroSpotlight";
import { HeroVantaNet } from "@/components/edge-site/HeroVantaNet";
import { HeroOutlineText } from "@/components/edge-site/HeroOutlineText";
import { StoreUrls } from "@/lib/constants";
import { getHeadlinePoints } from "./HomePage.data";

// ── Hero ─────────────────────────────────────────────────────────────

export function HomeHeroSection() {
  const { t } = useTranslation();
  const { isLoaded, isSignedIn } = useAuth();
  const appHref = isLoaded && isSignedIn ? "/app" : "/sign-in";
  const appLabel = isLoaded && isSignedIn ? t("home_go_to_app") : t("home_get_started_free");
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
      <div className="relative overflow-hidden">
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
              {t("home_hero1_line2")}<span className="edge-accent">.</span>
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
                aria-disabled={!isLoaded}
                onClick={(event) => { if (!isLoaded) event.preventDefault(); }}
                className={`group relative inline-flex items-center gap-2.5 rounded-full ecta px-8 py-4 text-[0.92rem] font-medium transition-all ${!isLoaded ? "pointer-events-none opacity-60" : ""}`}
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
