import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Github, Smartphone, TabletSmartphone } from "lucide-react";
import { StoreUrls } from "../../lib/constants";

const footerLinks = [
  { to: "/privacy", labelKey: "edge_nav_privacy" },
  { to: "/terms", labelKey: "edge_nav_terms" },
  { to: "/licensing", labelKey: "edge_nav_licensing" },
  { to: "/support", labelKey: "edge_nav_support" },
];

export function EdgeSiteFooter() {
  const { t } = useTranslation();

  return (
    <footer className="relative">
      <div className="edge-gradient-line" />

      <div className="container edge-sans py-16 md:py-24">
        {/* Top row — large brand mark + nav */}
        <div className="flex flex-col gap-12 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg eborder-06 border ebg-glass-02">
                <img
                  src="/edge-brand/nanthai_edge_monogram_v2_transp.png"
                  alt={t("edge_monogram_alt")}
                  className="h-6 w-6 object-contain"
                />
              </div>
              <span className="edge-display efg-85 text-[0.92rem] tracking-[-0.02em]">
                NanthAi<span className="text-[#FF6B3D]">:</span><span className="text-[#FF6B3D]">Edge</span>
              </span>
            </div>
            <p className="mt-5 max-w-xs text-[0.84rem] font-light leading-relaxed efg-45">
              {t("the_ai_you_need")} {t("at_the_price_you_want")}
            </p>
          </div>

          {/* Links — two columns */}
          <div className="flex gap-16">
            <div className="flex flex-col gap-3">
              <span className="edge-label efg-20">{t("edge_footer_product")}</span>

              <Link
                to="/features"
                className="text-[0.84rem] efg-40 transition-colors hover:efg-80"
              >
                {t("edge_nav_features")}
              </Link>
              <a
                href="https://chat.nanthai.tech"
                target="_blank"
                rel="noreferrer"
                className="text-[0.84rem] efg-40 transition-colors hover:efg-80"
              >
                {t("edge_footer_web_app")}
              </a>
              <a
                href="https://github.com/thevarsek/nanthai-edge-oss"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[0.84rem] efg-40 transition-colors hover:efg-80"
              >
                <Github className="h-3.5 w-3.5" />
                GitHub
              </a>
              <a
                href={StoreUrls.ios}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[0.84rem] efg-40 transition-colors hover:efg-80"
              >
                <Smartphone className="h-3.5 w-3.5" />
                iOS App
              </a>
              <a
                href={StoreUrls.android}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[0.84rem] efg-40 transition-colors hover:efg-80"
              >
                <TabletSmartphone className="h-3.5 w-3.5" />
                Android App
              </a>
            </div>
            <div className="flex flex-col gap-3">
              <span className="edge-label efg-20">{t("legal")}</span>
              {footerLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="text-[0.84rem] efg-40 transition-colors hover:efg-80"
                >
                  {t(link.labelKey)}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom — copyright */}
        <div className="mt-16 flex items-center justify-between pt-6" style={{ borderTop: `1px solid rgba(var(--edge-fg), 0.04)` }}>
          <p className="text-[0.72rem] font-light tracking-wide efg-15">
            &copy; {new Date().getFullYear()} NanthAI
          </p>
          <p className="edge-mono text-[0.65rem] efg-10">
            v2.0
          </p>
        </div>
      </div>
    </footer>
  );
}
