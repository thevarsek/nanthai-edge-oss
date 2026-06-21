import { Link } from "react-router-dom";
import { useAuth } from "@clerk/react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Seo } from "@/components/Seo";
import { EdgeSiteLayout } from "@/components/edge-site/EdgeSiteLayout";
import { captureCtaClick, ctaAuthState } from "@/lib/ctaAnalytics";
import { cn } from "@/lib/utils";
import { getRelatedFeatures, localizeFeature, type FeatureMeta, type FeatureTier } from "./featureData";
import { AnimateOnScroll } from "./illustrations/IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  FeaturePageLayout                                                  */
/*  Shared template for every feature explanation page.                */
/*  Enforces consistent structure, tone, and visual rhythm.            */
/* ------------------------------------------------------------------ */

function TierBadge({ tier }: { tier: FeatureTier }) {
  const { t } = useTranslation();
  if (tier === "none") return null;

  const labels: Record<Exclude<FeatureTier, "none">, string> = {
    free: t("free"),
    pro: t("pro_2"),
    "free-pro": t("edge_tier_free_pro"),
  };

  const styles: Record<Exclude<FeatureTier, "none">, string> = {
    free: "border-[var(--edge-cyan)] text-[var(--edge-cyan)]",
    pro: "border-[var(--edge-coral)] text-[var(--edge-coral)]",
    "free-pro": "border-[var(--edge-amber)] text-[var(--edge-amber)]",
  };

  return (
    <span
      className={cn(
        "inline-block rounded-full border px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.12em]",
        styles[tier],
      )}
    >
      {labels[tier]}
    </span>
  );
}

/* ── Step card for "How it works" section ─────────────────────────── */

export interface HowItWorksStep {
  number: number;
  title: string;
  description: string;
  icon: React.ReactNode;
}

function StepCard({ step }: { step: HowItWorksStep }) {
  return (
    <AnimateOnScroll delay={step.number * 0.1}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgba(var(--edge-fg),0.06)] text-[0.75rem] font-bold efg-30">
            {step.number}
          </div>
          <div className="h-px flex-1 bg-[rgba(var(--edge-fg),0.06)]" />
        </div>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 efg-40">{step.icon}</div>
          <div>
            <h3 className="text-[0.95rem] font-semibold efg-heading">
              {step.title}
            </h3>
            <p className="mt-1 text-[0.84rem] leading-relaxed efg-50">
              {step.description}
            </p>
          </div>
        </div>
      </div>
    </AnimateOnScroll>
  );
}

/* ── Capability card for "What you can do" section ───────────────── */

export interface Capability {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function CapabilityCard({ cap, index }: { cap: Capability; index: number }) {
  return (
    <AnimateOnScroll delay={index * 0.06}>
      <div className="group flex gap-3 rounded-xl border border-[rgba(var(--edge-fg),0.05)] bg-[rgba(var(--edge-fg),0.02)] p-4 transition-colors hover:border-[rgba(var(--edge-fg),0.10)] hover:bg-[rgba(var(--edge-fg),0.04)]">
        <div className="mt-0.5 efg-35 transition-colors group-hover:efg-55">
          {cap.icon}
        </div>
        <div>
          <h4 className="text-[0.85rem] font-semibold efg-80">
            {cap.title}
          </h4>
          <p className="mt-1 text-[0.8rem] leading-relaxed efg-45">
            {cap.description}
          </p>
        </div>
      </div>
    </AnimateOnScroll>
  );
}

/* ── Related feature card ────────────────────────────────────────── */

function RelatedCard({ feature }: { feature: FeatureMeta }) {
  const { t } = useTranslation();
  const Icon = feature.icon;
  return (
    <Link
      to={`/features/${feature.slug}`}
      className="group flex min-w-0 flex-col gap-3 rounded-xl border border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)] p-5 transition-all hover:border-[rgba(var(--edge-fg),0.12)] hover:bg-[rgba(var(--edge-fg),0.04)]"
    >
      <Icon size={20} className={cn("transition-colors", feature.accentClass)} />
      <div>
        <h4 className="text-[0.85rem] font-semibold efg-80 group-hover:efg-90 transition-colors">
          {feature.title}
        </h4>
        <p className="mt-1 text-[0.78rem] leading-relaxed efg-40">
          {feature.tagline}
        </p>
      </div>
      <span className="mt-auto flex items-center gap-1 text-[0.75rem] font-medium efg-25 group-hover:efg-50 transition-colors">
        {t("edge_learn_more")} <ArrowRight size={12} />
      </span>
    </Link>
  );
}

/* ── Main layout ─────────────────────────────────────────────────── */

interface FeaturePageLayoutProps {
  meta: FeatureMeta;
  /** Hero illustration — the main animated wireframe */
  illustration: React.ReactNode;
  /** 3–4 step "How it works" section */
  steps: HowItWorksStep[];
  /** Grid of capabilities */
  capabilities: Capability[];
  /** "Perfect for" scenarios */
  scenarios: string[];
  /** Optional extra sections between illustration and How It Works */
  extraContent?: React.ReactNode;
  /** SEO description override (defaults to indexDescription) */
  seoDescription?: string;
}

export function FeaturePageLayout({
  meta,
  illustration,
  steps,
  capabilities,
  scenarios,
  extraContent,
  seoDescription,
}: FeaturePageLayoutProps) {
  const { t } = useTranslation();
  const { isLoaded, isSignedIn } = useAuth();
  const localizedMeta = localizeFeature(meta, t);
  const related = getRelatedFeatures(meta.related).map((feature) => localizeFeature(feature, t));
  const appHref = isLoaded && isSignedIn ? "/app" : "/sign-in";
  const authState = ctaAuthState(isLoaded, isSignedIn);
  const ctaLabel = isLoaded && isSignedIn
    ? t("edge_go_to_app")
    : meta.tier === "pro" || meta.tier === "free-pro"
      ? t("edge_start_free_upgrade_later")
      : t("edge_start_free");
  const navItems = [
    steps.length > 0 ? { id: "feature-how", label: t("edge_how_it_works") } : null,
    capabilities.length > 0 ? { id: "feature-capabilities", label: t("edge_what_you_can_do") } : null,
    scenarios.length > 0 ? { id: "feature-scenarios", label: t("edge_perfect_for") } : null,
    related.length > 0 ? { id: "feature-related", label: t("edge_related_features") } : null,
  ].filter((item): item is { id: string; label: string } => item !== null);

  return (
    <EdgeSiteLayout activePage="features">
      <Seo
        title={`${localizedMeta.title} — NanthAI Edge`}
        description={seoDescription ?? localizedMeta.indexDescription}
        url={`https://nanthai.tech/features/${localizedMeta.slug}`}
        canonical={`https://nanthai.tech/features/${localizedMeta.slug}`}
      />

      <div className="edge-sans">
        {/* ── Hero ───────────────────────────────────────────────── */}
        <section className="container pt-24 pb-16 md:pt-32 md:pb-24">
          <div className="mx-auto max-w-3xl text-center">
            <AnimateOnScroll>
              <TierBadge tier={meta.tier} />
            </AnimateOnScroll>

            <AnimateOnScroll delay={0.08}>
              <h1 className="mt-5 edge-display text-[2.2rem] md:text-[3.2rem] leading-[1.05] efg-heading">
                {localizedMeta.title}
              </h1>
            </AnimateOnScroll>

            <AnimateOnScroll delay={0.16}>
              <p className="mt-5 text-[1.05rem] md:text-[1.15rem] leading-relaxed efg-50 max-w-xl mx-auto">
                {localizedMeta.tagline}
              </p>
            </AnimateOnScroll>
          </div>

          {/* Illustration */}
          <AnimateOnScroll delay={0.24} className="mt-14 md:mt-20">
            <div className="mx-auto max-w-4xl">{illustration}</div>
          </AnimateOnScroll>
        </section>

        {/* ── Extra content (optional) ──────────────────────────── */}
        {extraContent && (
          <section className="container pb-16 md:pb-24">
            {extraContent}
          </section>
        )}

        <div className="container grid min-w-0 gap-12 pb-20 md:pb-28 lg:grid-cols-[220px_1fr] lg:gap-16">
          {navItems.length > 0 && (
            <aside className="hidden lg:block">
              <nav className="sticky top-28 border-l border-[rgba(var(--edge-fg),0.08)] pl-5">
                <p className="edge-label efg-20">{t("edge_nav_features")}</p>
                <div className="mt-5 flex flex-col gap-3">
                  {navItems.map((item) => (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      className="text-[0.82rem] efg-35 transition-colors hover:efg-70"
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              </nav>
            </aside>
          )}

          <div className="grid min-w-0 gap-20 md:gap-24">
            {/* ── How It Works ──────────────────────────────────────── */}
            {steps.length > 0 && (
              <section id="feature-how" className="scroll-mt-28">
                <AnimateOnScroll>
                  <div className="mb-10 grid gap-4 md:grid-cols-[0.8fr_1.2fr] md:items-end">
                    <h2 className="edge-display text-[1.65rem] md:text-[2rem] efg-heading">
                      {t("edge_how_it_works")}
                    </h2>
                    <div className="hidden h-px bg-[rgba(var(--edge-fg),0.08)] md:block" />
                  </div>
                </AnimateOnScroll>
                <div className="grid gap-10 md:gap-12">
                  {steps.map((step) => (
                    <StepCard key={step.number} step={step} />
                  ))}
                </div>
              </section>
            )}

            {/* ── What You Can Do ───────────────────────────────────── */}
            {capabilities.length > 0 && (
              <section id="feature-capabilities" className="scroll-mt-28">
                <AnimateOnScroll>
                  <div className="mb-10 grid gap-4 md:grid-cols-[0.8fr_1.2fr] md:items-end">
                    <h2 className="edge-display text-[1.65rem] md:text-[2rem] efg-heading">
                      {t("edge_what_you_can_do")}
                    </h2>
                    <div className="hidden h-px bg-[rgba(var(--edge-fg),0.08)] md:block" />
                  </div>
                </AnimateOnScroll>
                <div className="grid gap-4 sm:grid-cols-2">
                  {capabilities.map((cap, i) => (
                    <CapabilityCard key={cap.title} cap={cap} index={i} />
                  ))}
                </div>
              </section>
            )}

            {/* ── Perfect For ───────────────────────────────────────── */}
            {scenarios.length > 0 && (
              <section id="feature-scenarios" className="scroll-mt-28">
                <AnimateOnScroll>
                  <div className="mb-8 grid gap-4 md:grid-cols-[0.8fr_1.2fr] md:items-end">
                    <h2 className="edge-display text-[1.65rem] md:text-[2rem] efg-heading">
                      {t("edge_perfect_for")}
                    </h2>
                    <div className="hidden h-px bg-[rgba(var(--edge-fg),0.08)] md:block" />
                  </div>
                </AnimateOnScroll>
                <div className="grid gap-4 md:grid-cols-2">
                  {scenarios.map((s, i) => (
                    <AnimateOnScroll key={i} delay={i * 0.06}>
                      <div className="flex h-full items-start gap-3 rounded-xl border border-[rgba(var(--edge-fg),0.05)] bg-[rgba(var(--edge-fg),0.02)] px-5 py-4">
                        <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--edge-cyan)]" />
                        <p className="text-[0.88rem] leading-relaxed efg-55">{s}</p>
                      </div>
                    </AnimateOnScroll>
                  ))}
                </div>
              </section>
            )}

            {/* ── Related Features ──────────────────────────────────── */}
            {related.length > 0 && (
              <section id="feature-related" className="scroll-mt-28">
                <AnimateOnScroll>
                  <div className="mb-8 grid gap-4 md:grid-cols-[0.8fr_1.2fr] md:items-end">
                    <h2 className="edge-display text-[1.65rem] md:text-[2rem] efg-heading">
                      {t("edge_related_features")}
                    </h2>
                    <div className="hidden h-px bg-[rgba(var(--edge-fg),0.08)] md:block" />
                  </div>
                </AnimateOnScroll>
                <div className="grid gap-4 sm:grid-cols-3">
                  {related.map((f) => (
                    <RelatedCard key={f.slug} feature={f} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        {/* ── CTA ───────────────────────────────────────────────── */}
        <section className="container pb-24 md:pb-32">
          <AnimateOnScroll>
            <div className="mx-auto max-w-lg text-center">
              <h2 className="edge-display text-[1.3rem] md:text-[1.6rem] efg-heading">
                {meta.tier === "pro"
                  ? t("edge_cta_unlock_pro")
                  : meta.tier === "free-pro"
                    ? t("edge_cta_start_free_upgrade")
                    : t("edge_cta_ready_to_try")}
              </h2>
              <p className="mt-3 text-[0.88rem] efg-40">
                {meta.tier === "pro"
                  ? t("edge_cta_one_time_purchase")
                  : meta.tier === "free-pro"
                    ? t("edge_cta_basic_free_pro_power")
                    : t("edge_cta_create_free_account")}
              </p>
              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <Link
                  to={appHref}
                  aria-disabled={!isLoaded}
                  onClick={(event) => {
                    if (!isLoaded) {
                      event.preventDefault();
                      return;
                    }
                    captureCtaClick({
                      location: "feature_footer",
                      label: ctaLabel,
                      destination: appHref,
                      authState,
                    });
                  }}
                  className={`ecta inline-flex items-center gap-2 rounded-full px-6 py-3 text-[0.85rem] font-semibold ${!isLoaded ? "pointer-events-none opacity-60" : ""}`}
                >
                  {ctaLabel}
                  <ArrowUpRight size={14} />
                </Link>
                <Link
                  to="/features"
                  onClick={() => {
                    captureCtaClick({
                      location: "feature_footer_all_features",
                      label: t("edge_see_all_features"),
                      destination: "/features",
                      authState,
                    });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full px-5 py-3 text-[0.82rem] font-medium efg-40 transition-colors hover:efg-70"
                >
                  {t("edge_see_all_features")} <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          </AnimateOnScroll>
        </section>
      </div>
    </EdgeSiteLayout>
  );
}
