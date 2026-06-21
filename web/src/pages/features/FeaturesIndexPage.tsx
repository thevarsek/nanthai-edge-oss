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

const heroFeatureSlugs = ["multi-model-chat", "search", "byok"];

const heroFeatureTitleOverrides: Record<string, string> = {
  byok: "B.Y.O.K.",
  search: "Search & research",
};

const featureGroups = [
  {
    title: "Chat foundation",
    description: "The primitives for choosing models, branching work, and keeping conversations organised.",
    slugs: ["participant-options", "branching", "chat-defaults", "folders", "themes"],
  },
  {
    title: "Generated media",
    description: "Audio, image, and video creation without leaving the same workspace.",
    slugs: ["audio-generation", "image-generation", "video-generation"],
  },
  {
    title: "Knowledge and context",
    description: "Persistent memory, reference material, and spatial thinking tools for longer-running work.",
    slugs: ["personas", "memories", "knowledge-base", "ideascapes"],
  },
  {
    title: "Automation and connected work",
    description: "Scheduled jobs and connected services for work that should continue outside one chat.",
    slugs: ["automated-tasks", "integrations"],
  },
  {
    title: "Cost control",
    description: "Clear pricing and plan boundaries for choosing how Edge should spend.",
    slugs: ["price-transparency", "pro-vs-free"],
  },
];

function FeatureHeroCard({ feature, index }: { feature: FeatureMeta; index: number }) {
  const { t } = useTranslation();
  const Icon = feature.icon;
  const title = heroFeatureTitleOverrides[feature.slug] ?? feature.title;

  return (
    <AnimateOnScroll delay={index * 0.06}>
      <Link
        to={`/features/${feature.slug}`}
        className="group grid h-full min-h-[260px] grid-rows-[2rem_4.75rem_1fr_auto] gap-4 rounded-[1.4rem] border border-[rgba(var(--edge-fg),0.08)] bg-[rgba(var(--edge-fg),0.035)] p-7 transition-all hover:border-[rgba(var(--edge-fg),0.16)] hover:bg-[rgba(var(--edge-fg),0.055)]"
      >
        <div className="flex h-8 items-start justify-between gap-4">
          <Icon size={24} className={cn("transition-transform group-hover:scale-110", feature.accentClass)} />
          <TierPill tier={feature.tier} />
        </div>
        <h2 className="edge-display self-end text-[clamp(1.5rem,2.2vw,2.05rem)] leading-[1.06] [text-wrap:balance] efg-heading">
          {title}
        </h2>
        <p className="max-w-[42ch] text-[0.9rem] leading-[1.62] efg-55">
          {feature.indexDescription}
        </p>
        <span className="inline-flex items-center gap-1.5 text-[0.78rem] font-medium efg-40 transition-colors group-hover:efg-70">
          {t("edge_learn_more")} <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </AnimateOnScroll>
  );
}

function FeatureGroupSection({
  title,
  description,
  features: groupFeatures,
  offset,
}: {
  title: string;
  description: string;
  features: FeatureMeta[];
  offset: number;
}) {
  return (
    <section className="grid gap-6 border-t border-[rgba(var(--edge-fg),0.06)] pt-8 lg:grid-cols-[0.75fr_1.45fr]">
      <div>
        <h2 className="edge-display text-[clamp(1.35rem,2vw,1.75rem)] efg-heading">
          {title}
        </h2>
        <p className="mt-3 max-w-sm text-[0.86rem] leading-relaxed efg-45">
          {description}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {groupFeatures.map((feature, i) => (
          <FeatureCard key={feature.slug} feature={feature} index={offset + i} />
        ))}
      </div>
    </section>
  );
}

export function FeaturesIndexPage() {
  const { t } = useTranslation();
  const localizedFeatures = features.map((feature) => localizeFeature(feature, t));
  const bySlug = new Map(localizedFeatures.map((feature) => [feature.slug, feature]));
  const heroFeatures = heroFeatureSlugs
    .map((slug) => bySlug.get(slug))
    .filter((feature): feature is FeatureMeta => feature !== undefined);
  const groupedFeatures = featureGroups.map((group) => ({
    ...group,
    features: group.slugs
      .map((slug) => bySlug.get(slug))
      .filter((feature): feature is FeatureMeta => feature !== undefined),
  }));

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

        {/* Featured workflows */}
        <section className="container pb-16 md:pb-24">
          <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1.18fr_1.08fr_1fr]">
            {heroFeatures.map((feature, i) => (
              <FeatureHeroCard key={feature.slug} feature={feature} index={i} />
            ))}
          </div>
        </section>

        {/* Feature groups */}
        <section className="container pb-24 md:pb-32">
          <div className="mx-auto grid max-w-6xl gap-12 md:gap-16">
            {groupedFeatures.map((group, i) => (
              <FeatureGroupSection
                key={group.title}
                title={group.title}
                description={group.description}
                features={group.features}
                offset={i * 4}
              />
            ))}
          </div>
        </section>
      </div>
    </EdgeSiteLayout>
  );
}
