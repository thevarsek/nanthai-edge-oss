import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Seo } from "@/components/Seo";
import { EdgeSiteLayout } from "@/components/edge-site/EdgeSiteLayout";

const lastUpdatedDate = "March 6, 2026";

export function TermsPage() {
  const { t } = useTranslation();
  return (
    <EdgeSiteLayout activePage="terms" mainClassName="container py-14 md:py-20">
      <Seo
        title="Terms of Service | NanthAI Edge"
        description={t("tos_seo_desc")}
        url="https://nanthai.tech/terms"
        canonical="https://nanthai.tech/terms"
        image="https://nanthai.tech/apple-splash-1200x630.png"
      >
        <link rel="alternate" type="text/plain" href="https://nanthai.tech/llms.txt" />
        <link
          rel="alternate"
          type="text/markdown"
          href="https://nanthai.tech/llms/edge-terms.md"
        />
      </Seo>

      <div className="mx-auto max-w-4xl">
        <header className="edge-card edge-fade-up edge-stagger-1 rounded-2xl p-8 md:p-10">
          <span className="edge-label efg-25">{t("tos_label")}</span>
          <h1 className="edge-display mt-6 text-[clamp(2.4rem,5vw,4rem)] efg-heading">
            {t("tos_hero_title")}
            <br />
             <span className="edge-accent">NanthAI Edge.</span>
          </h1>
          <p className="edge-sans mt-6 max-w-3xl text-[0.95rem] font-light leading-[1.8] efg-60">
            {t("tos_hero_desc")}
          </p>
          <p className="edge-mono mt-5 text-[0.7rem] efg-20">
            {t("tos_last_updated")} {lastUpdatedDate}
          </p>
        </header>

        <article className="edge-legal edge-card edge-fade-up edge-stagger-2 mt-4 rounded-2xl p-8 md:p-10">
          <h2>{t("tos_s1_title")}</h2>
          <p>{t("tos_s1_body")}</p>

          <h2>{t("tos_s2_title")}</h2>
          <p>{t("tos_s2_body")}</p>

          <h2>{t("tos_s3_title")}</h2>
          <p>{t("tos_s3_body1")}</p>
          <p>{t("tos_s3_body2")}</p>

          <h2>{t("tos_s4_title")}</h2>
          <p>{t("tos_s4_body")}</p>

          <h2>{t("tos_s5_title")}</h2>
          <p>{t("tos_s5_body1")}</p>
          <p>{t("tos_s5_body2")}</p>

          <h2>{t("tos_s6_title")}</h2>
          <ul>
            <li>{t("tos_s6_item1")}</li>
            <li>{t("tos_s6_item2")}</li>
            <li>{t("tos_s6_item3")}</li>
            <li>{t("tos_s6_item4")}</li>
          </ul>

          <h2>{t("tos_s7_title")}</h2>
          <p>{t("tos_s7_body")}</p>

          <h2>{t("tos_s8_title")}</h2>
          <p>{t("tos_s8_body")}</p>

          <h2>{t("tos_s9_title")}</h2>
          <p>{t("tos_s9_body")}</p>

          <h2>{t("tos_s10_title")}</h2>
          <p>{t("tos_s10_body")}</p>

          <h2>{t("tos_s11_title")}</h2>
          <p>
            {t("tos_s11_body_pre")}{" "}
            <Link to="/privacy">{t("tos_s11_privacy_link")}</Link>. {t("tos_s11_body_post")}{" "}
            <a href="mailto:support@nanthai.tech">support@nanthai.tech</a>.
          </p>

          <h2>{t("tos_s12_title")}</h2>
          <p>{t("tos_s12_body")}</p>
        </article>
      </div>
    </EdgeSiteLayout>
  );
}
