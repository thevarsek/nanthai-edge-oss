import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Seo } from "@/components/Seo";
import { EdgeSiteLayout } from "@/components/edge-site/EdgeSiteLayout";
import { features, localizeFeature, type FeatureMeta, type FeatureTier } from "./featureData";
import { AnimateOnScroll } from "./illustrations/IllustrationPrimitives";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Features Index Page                                                */
/*  /features — Grid of all feature cards with tier badges.            */
/* ------------------------------------------------------------------ */

function TierPill({ tier }: { tier: FeatureTier }) {
  const { t } = useTranslation();
  if (tier === "none") return null;

  const labels: Record<Exclude<FeatureTier, "none">, string> = {
    free: t("free"),
    pro: t("pro_2"),
    "free-pro": t("edge_tier_free_pro"),
  };

  const styles: Record<Exclude<FeatureTier, "none">, string> = {
    free: "border-[var(--edge-cyan)]/30 text-[var(--edge-cyan)]",
    pro: "border-[var(--edge-coral)]/30 text-[var(--edge-coral)]",
    "free-pro": "border-[var(--edge-amber)]/30 text-[var(--edge-amber)]",
  };

  return (
    <span
      className={cn(
        "inline-block rounded-full border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.1em]",
        styles[tier],
      )}
    >
      {labels[tier]}
    </span>
  );
}

function FeatureCard({ feature, index }: { feature: FeatureMeta; index: number }) {
  const { t } = useTranslation();
  const Icon = feature.icon;

  return (
    <AnimateOnScroll delay={index * 0.04}>
      <Link
        to={`/features/${feature.slug}`}
        className="group flex flex-col gap-4 rounded-2xl border border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)] p-6 transition-all hover:border-[rgba(var(--edge-fg),0.12)] hover:bg-[rgba(var(--edge-fg),0.04)] h-full"
      >
        <div className="flex items-center justify-between">
          <Icon
            size={22}
            className={cn("transition-transform group-hover:scale-110", feature.accentClass)}
          />
          <TierPill tier={feature.tier} />
        </div>

        <div className="flex-1">
          <h3 className="text-[0.95rem] font-semibold efg-80 group-hover:efg-95 transition-colors">
            {feature.title}
          </h3>
          <p className="mt-2 text-[0.82rem] leading-relaxed efg-40">
            {feature.indexDescription}
          </p>
        </div>

        <span className="flex items-center gap-1.5 text-[0.75rem] font-medium efg-25 group-hover:efg-50 transition-colors mt-auto">
          {t("edge_learn_more")} <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </AnimateOnScroll>
  );
}

export function FeaturesIndexPage() {
  const { t } = useTranslation();
  const localizedFeatures = features.map((feature) => localizeFeature(feature, t));
  return (
    <EdgeSiteLayout activePage="features">
      <Seo
        title="Features — NanthAI Edge"
        description={t("fi_seo_desc")}
        url="https://nanthai.tech/features"
        canonical="https://nanthai.tech/features"
      />

      <div className="edge-sans">
        {/* Hero */}
        <section className="container pt-24 pb-16 md:pt-32 md:pb-24">
          <div className="mx-auto max-w-3xl text-center">
            <AnimateOnScroll>
              <h1 className="edge-display text-[2.2rem] md:text-[3.2rem] leading-[1.05] efg-heading">
                {t("fi_hero_title")}
              </h1>
            </AnimateOnScroll>

            <AnimateOnScroll delay={0.08}>
              <p className="mt-5 text-[1.05rem] md:text-[1.15rem] leading-relaxed efg-50 max-w-xl mx-auto">
                {t("fi_hero_desc")}
              </p>
            </AnimateOnScroll>
          </div>
        </section>

        {/* Feature Grid */}
        <section className="container pb-24 md:pb-32">
          <div className="mx-auto max-w-5xl grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {localizedFeatures.map((feature, i) => (
              <FeatureCard key={feature.slug} feature={feature} index={i} />
            ))}
          </div>
        </section>
      </div>
    </EdgeSiteLayout>
  );
}
