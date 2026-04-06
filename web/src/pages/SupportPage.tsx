import { useTranslation } from "react-i18next";
import { Seo } from "@/components/Seo";
import { EdgeSiteLayout } from "@/components/edge-site/EdgeSiteLayout";

const supportEmail = "support@nanthai.tech";

export function SupportPage() {
  const { t } = useTranslation();
  return (
    <EdgeSiteLayout activePage="support" mainClassName="container py-14 md:py-20">
      <Seo
        title="Support | NanthAI Edge"
        description={t("sp_seo_desc")}
        url="https://nanthai.tech/support"
        canonical="https://nanthai.tech/support"
        image="https://nanthai.tech/apple-splash-1200x630.png"
      >
        <link rel="alternate" type="text/plain" href="https://nanthai.tech/llms.txt" />
        <link
          rel="alternate"
          type="text/markdown"
          href="https://nanthai.tech/llms/edge-support.md"
        />
      </Seo>

      <div className="mx-auto max-w-4xl">
        {/* Hero header */}
        <header className="edge-card edge-fade-up edge-stagger-1 rounded-2xl p-8 md:p-10">
          <span className="edge-label efg-25">{t("sp_label")}</span>
          <h1 className="edge-display mt-6 text-[clamp(2.4rem,5vw,4rem)] efg-heading">
            {t("sp_hero_title")}
            <br />
            <span className="text-[#FF6B3D]">{t("sp_hero_title_accent")}</span>
          </h1>
          <p className="edge-sans mt-6 max-w-3xl text-[0.95rem] font-light leading-[1.8] efg-60">
            {t("sp_hero_desc")}
          </p>
        </header>

        {/* Two-column cards */}
        <div className="mt-4 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <section className="edge-card edge-fade-up edge-stagger-2 rounded-2xl p-8">
            <span className="edge-label efg-20">{t("sp_primary_contact")}</span>
            <a
              href={`mailto:${supportEmail}`}
              className="edge-display mt-5 block text-[clamp(1.6rem,3.5vw,2.4rem)] efg-heading transition-colors hover:text-[var(--edge-cyan)]"
            >
              {supportEmail}
            </a>
            <p className="edge-sans mt-5 text-[0.88rem] font-light leading-[1.8] efg-55">
              {t("sp_contact_desc")}
            </p>
          </section>

          <section className="edge-card edge-fade-up edge-stagger-3 rounded-2xl p-8">
            <span className="edge-label efg-20">{t("sp_what_to_include")}</span>
            <ul className="edge-sans mt-5 space-y-3 text-[0.88rem] font-light leading-[1.8] efg-55">
              <li>{t("sp_include_1")}</li>
              <li>{t("sp_include_2")}</li>
              <li>{t("sp_include_3")}</li>
              <li>{t("sp_include_4")}</li>
            </ul>
          </section>
        </div>
      </div>
    </EdgeSiteLayout>
  );
}
