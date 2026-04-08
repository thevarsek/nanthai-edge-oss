import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Seo } from "@/components/Seo";
import { EdgeSiteLayout } from "@/components/edge-site/EdgeSiteLayout";

export function LicensingPage() {
  const { t } = useTranslation();
  return (
    <EdgeSiteLayout activePage="licensing" mainClassName="container py-14 md:py-20">
      <Seo
        title="Licensing | NanthAI Edge"
        description={t("lic_seo_desc")}
        url="https://nanthai.tech/licensing"
        canonical="https://nanthai.tech/licensing"
        image="https://nanthai.tech/apple-splash-1200x630.png"
      >
        <link rel="alternate" type="text/plain" href="https://nanthai.tech/llms.txt" />
        <link
          rel="alternate"
          type="text/markdown"
          href="https://nanthai.tech/llms/edge-licensing.md"
        />
      </Seo>

      <div className="mx-auto max-w-4xl">
        <header className="edge-card edge-fade-up edge-stagger-1 rounded-2xl p-8 md:p-10">
          <span className="edge-label efg-25">{t("lic_label")}</span>
          <h1 className="edge-display mt-6 text-[clamp(2.4rem,5vw,4rem)] efg-heading">
            {t("lic_hero_title")}
            <br />
            <span className="edge-accent">{t("lic_hero_title_2")}</span>
          </h1>
          <p className="edge-sans mt-6 max-w-3xl text-[0.95rem] font-light leading-[1.8] efg-60">
            {t("lic_hero_desc")}
          </p>
        </header>

        {/* Callout: this page is about source code licensing, not using the product */}
        <div className="edge-card edge-fade-up edge-stagger-2 mt-4 rounded-2xl p-6 md:p-8" style={{ borderColor: "rgba(255,107,61,0.2)" }}>
          <p className="edge-sans text-[0.9rem] font-medium efg-heading">
            {t("lic_note_title")}
          </p>
          <p className="edge-sans mt-2 text-[0.85rem] font-light leading-[1.8] efg-50">
            {t("lic_note_body")}{" "}
            <Link to="/features" className="text-[#91efff] hover:underline">
              {t("edge_nav_features")}
            </Link>
          </p>
          <p className="edge-sans mt-3 text-[0.85rem] font-light leading-[1.8] efg-50">
            <a
              href="https://github.com/thevarsek/nanthai-edge-oss"
              target="_blank"
              rel="noreferrer"
              className="text-[#91efff] hover:underline"
            >
              {t("lic_note_github")}
            </a>
          </p>
        </div>

        <article className="edge-legal edge-card edge-fade-up edge-stagger-3 mt-4 rounded-2xl p-8 md:p-10">
          <h2>{t("lic_s1_title")}</h2>
          <p>{t("lic_s1_body")}</p>

          <h2>{t("lic_s2_title")}</h2>
          <p>{t("lic_s2_body")}</p>
          <ul>
            <li>{t("lic_s2_item1")}</li>
            <li>{t("lic_s2_item2")}</li>
            <li>{t("lic_s2_item3")}</li>
            <li>{t("lic_s2_item4")}</li>
            <li>{t("lic_s2_item5")}</li>
          </ul>

          <h2>{t("lic_s3_title")}</h2>
          <p>{t("lic_s3_body")}</p>
          <ul>
            <li>{t("lic_s3_item1")}</li>
            <li>{t("lic_s3_item2")}</li>
            <li>{t("lic_s3_item3")}</li>
            <li>{t("lic_s3_item4")}</li>
          </ul>

          <h2>{t("lic_s4_title")}</h2>
          <p>{t("lic_s4_body")}</p>
          <ul>
            <li>{t("lic_s4_item1")}</li>
            <li>{t("lic_s4_item2")}</li>
            <li>{t("lic_s4_item3")}</li>
            <li>{t("lic_s4_item4")}</li>
            <li>{t("lic_s4_item5")}</li>
            <li>{t("lic_s4_item6")}</li>
          </ul>

          <h2>{t("lic_s5_title")}</h2>
          <p>{t("lic_s5_body")}</p>
          <ul>
            <li><strong>{t("lic_s5_item1_label")}</strong> {t("lic_s5_item1_desc")}</li>
            <li><strong>{t("lic_s5_item2_label")}</strong> {t("lic_s5_item2_desc")}</li>
          </ul>

          <h2>{t("lic_s6_title")}</h2>

          <h3>{t("lic_s6_q1")}</h3>
          <p>{t("lic_s6_a1")}</p>

          <h3>{t("lic_s6_q2")}</h3>
          <p>{t("lic_s6_a2")}</p>

          <h3>{t("lic_s6_q3")}</h3>
          <p>{t("lic_s6_a3")}</p>

          <h3>{t("lic_s6_q4")}</h3>
          <p>{t("lic_s6_a4")}</p>

          <h2>{t("lic_s7_title")}</h2>
          <p>
            {t("lic_s7_body")}{" "}
            <a href="mailto:support@nanthai.tech">support@nanthai.tech</a>.
          </p>
        </article>
      </div>
    </EdgeSiteLayout>
  );
}
