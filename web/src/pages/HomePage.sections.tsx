import { Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getCapabilityCards, getHowItWorksSteps, getIntegrations } from "./HomePage.data";

// ── How it works (BYOK) ─────────────────────────────────────────────

export function HomeHowItWorksSection() {
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
              <span className="edge-accent">{t("home_hiw_heading_line2")}</span>
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

export function HomeCapabilitiesSection() {
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
              <span className="edge-accent">{t("home_cap_heading_line2")}</span>
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

export function HomeIntegrationsSection() {
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
              <span className="edge-accent">{t("home_int_heading_line2")}</span>
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
                <h3 className="edge-sans text-[1.05rem] font-medium tracking-[-0.01em] efg-85">
                  {item.name}
                </h3>
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

        <p className="edge-sans mt-8 text-center text-[0.82rem] font-light efg-30">
          {t("home_int_footer")}
        </p>
      </div>
    </section>
  );
}

