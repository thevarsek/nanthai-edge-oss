import { useTranslation } from "react-i18next";
import { Seo } from "@/components/Seo";
import { EdgeSiteLayout } from "@/components/edge-site/EdgeSiteLayout";

const lastUpdatedDate = "March 7, 2026";

export function PrivacyPage() {
  const { t } = useTranslation();
  return (
    <EdgeSiteLayout activePage="privacy" mainClassName="container py-14 md:py-20">
      <Seo
        title="Privacy Policy | NanthAI Edge"
        description={t("priv_seo_desc")}
        url="https://nanthai.tech/privacy"
        canonical="https://nanthai.tech/privacy"
        image="https://nanthai.tech/apple-splash-1200x630.png"
      >
        <link rel="alternate" type="text/plain" href="https://nanthai.tech/llms.txt" />
        <link
          rel="alternate"
          type="text/markdown"
          href="https://nanthai.tech/llms/edge-privacy.md"
        />
      </Seo>

      <div className="mx-auto max-w-4xl">
        <PrivacyHeader lastUpdated={lastUpdatedDate} />
        <PrivacyBody />
      </div>
    </EdgeSiteLayout>
  );
}

// MARK: - Header

function PrivacyHeader({ lastUpdated }: { lastUpdated: string }) {
  const { t } = useTranslation();
  return (
    <header className="edge-card edge-fade-up edge-stagger-1 rounded-2xl p-8 md:p-10">
      <span className="edge-label efg-25">{t("priv_label")}</span>
      <h1 className="edge-display mt-6 text-[clamp(2.4rem,5vw,4rem)] efg-heading">
        {t("priv_hero_title")}
        <br />
        <span className="edge-accent">{t("priv_hero_title_accent")}</span>
      </h1>
      <p className="edge-sans mt-6 max-w-3xl text-[0.95rem] font-light leading-[1.8] efg-60">
        {t("priv_hero_desc")}
      </p>
      <p className="edge-mono mt-5 text-[0.7rem] efg-20">
        {t("priv_last_updated")} {lastUpdated}
      </p>
    </header>
  );
}

// MARK: - Legal body

function PrivacyBody() {
  const { t } = useTranslation();
  return (
    <article className="edge-legal edge-card edge-fade-up edge-stagger-2 mt-4 rounded-2xl p-8 md:p-10">
      <h2>{t("priv_s1_title")}</h2>
      <p>{t("priv_s1_body")}</p>

      <h2>{t("priv_s2_title")}</h2>
      <h3>{t("priv_s2a_title")}</h3>
      <p>{t("priv_s2a_body")}</p>

      <h3>{t("priv_s2b_title")}</h3>
      <ul>
        <li>{t("priv_s2b_item1")}</li>
        <li>{t("priv_s2b_item2")}</li>
        <li>{t("priv_s2b_item3")}</li>
        <li>{t("priv_s2b_item4")}</li>
        <li>{t("priv_s2b_item5")}</li>
        <li>{t("priv_s2b_item6")}</li>
      </ul>

      <h3>{t("priv_s2c_title")}</h3>
      <p>{t("priv_s2c_body1")}</p>
      <p>{t("priv_s2c_body2")}</p>

      <h3>{t("priv_s2d_title")}</h3>
      <p>{t("priv_s2d_body")}</p>

      <h2>{t("priv_s3_title")}</h2>
      <ul>
        <li>{t("priv_s3_item1")}</li>
        <li>{t("priv_s3_item2")}</li>
        <li>{t("priv_s3_item3")}</li>
        <li>{t("priv_s3_item4")}</li>
        <li>{t("priv_s3_item5")}</li>
        <li>{t("priv_s3_item6")}</li>
      </ul>

      <h2>{t("priv_s4_title")}</h2>
      <p>{t("priv_s4_body")}</p>

      <h2>{t("priv_s5_title")}</h2>
      <p>{t("priv_s5_body1")}</p>
      <p>{t("priv_s5_body2")}</p>

      <h3>{t("priv_s5a_title")}</h3>
      <p>{t("priv_s5a_body1")}</p>
      <p>{t("priv_s5a_body2")}</p>

      <h3>{t("priv_s5b_title")}</h3>
      <p>{t("priv_s5b_body")}</p>

      <h3>{t("priv_s5c_title")}</h3>
      <p>{t("priv_s5c_body")}</p>

      <h3>{t("priv_s5d_title")}</h3>
      <p>{t("priv_s5d_body")}</p>

      <h2>{t("priv_s6_title")}</h2>
      <p>{t("priv_s6_body")}</p>

      <h2>{t("priv_s7_title")}</h2>
      <p>{t("priv_s7_body1")}</p>
      <ul>
        <li>{t("priv_s7_item1")}</li>
        <li>{t("priv_s7_item2")}</li>
        <li>{t("priv_s7_item3")}</li>
        <li>{t("priv_s7_item4")}</li>
        <li>{t("priv_s7_item5")}</li>
      </ul>
      <p>{t("priv_s7_body2")}</p>

      <h2>{t("priv_s8_title")}</h2>
      <p>{t("priv_s8_body")}</p>

      <h2>{t("priv_s9_title")}</h2>
      <ul>
        <li>{t("priv_s9_item1")}</li>
        <li>{t("priv_s9_item2")}</li>
        <li>{t("priv_s9_item3")}</li>
        <li>{t("priv_s9_item4")}</li>
        <li>{t("priv_s9_item5")}</li>
      </ul>
      <p>{t("priv_s9_body")}</p>

      <h2>{t("priv_s10_title")}</h2>
      <p>{t("priv_s10_body1")}</p>
      <p>{t("priv_s10_body2")}</p>

      <h2>{t("priv_s11_title")}</h2>
      <p>{t("priv_s11_body")}</p>

      <h2>{t("priv_s12_title")}</h2>
      <p>{t("priv_s12_body")}</p>

      <h2>{t("priv_s13_title")}</h2>
      <p>
        {t("priv_s13_body")}{" "}
        <a href="mailto:support@nanthai.tech">support@nanthai.tech</a>.
      </p>
    </article>
  );
}
