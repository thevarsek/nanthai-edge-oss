import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";

type EdgeSiteHeaderProps = {
  activePage?: "home" | "privacy" | "terms" | "support" | "features" | "licensing";
};

const navItems = [
  { href: "/features", labelKey: "edge_nav_features", page: "features" as const },
  { href: "/privacy", labelKey: "edge_nav_privacy", page: "privacy" as const },
  { href: "/terms", labelKey: "edge_nav_terms", page: "terms" as const },
  { href: "/licensing", labelKey: "edge_nav_licensing", page: "licensing" as const },
  { href: "/support", labelKey: "edge_nav_support", page: "support" as const },
];

export function EdgeSiteHeader({ activePage }: EdgeSiteHeaderProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { isSignedIn } = useAuth();
  const { t } = useTranslation();

  const appHref = isSignedIn ? "/app" : "/sign-in";
  const appLabel = isSignedIn ? t("edge_go_to_app") : t("sign_in");

  return (
    <header className="sticky top-0 z-50 eborder-04 border-b backdrop-blur-2xl" style={{ backgroundColor: `rgba(var(--edge-fg), 0) `, background: `color-mix(in srgb, var(--edge-bg) 70%, transparent)` }}>
      <div className="container edge-sans flex h-16 items-center justify-between gap-6">
        {/* Logo — minimal, typographic */}
        <Link to="/" className="group flex items-center gap-3" aria-label={t("edge_home_aria")}>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg eborder-06 border ebg-glass-02 transition-all group-hover:eborder-12 group-hover:ebg-glass-04">
            <img
              src="/edge-brand/nanthai_edge_monogram_v2_transp.png"
              alt={t("edge_monogram_alt")}
              className="h-6 w-6 object-contain"
            />
          </div>
          <span className="edge-display efg-85 text-[0.92rem] tracking-[-0.02em]">
            NanthAi<span className="edge-accent">:</span><span className="edge-accent">Edge</span>
          </span>
        </Link>

        {/* Desktop nav — minimal underline style */}
        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className={
                activePage === item.page
                  ? "relative px-3.5 py-2 text-[0.82rem] font-medium efg-90 transition-colors after:absolute after:bottom-0 after:left-3.5 after:right-3.5 after:h-px" + " after:bg-[rgba(var(--edge-fg),0.4)]"
                  : "px-3.5 py-2 text-[0.82rem] efg-35 transition-colors hover:efg-70"
              }
            >
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>

        {/* Desktop actions */}
        <div className="hidden items-center gap-2 md:flex">
          <LanguageSwitcher variant="header" />
          <Link
            to={appHref}
            className="group/btn inline-flex items-center gap-1 rounded-full px-4 py-2 text-[0.8rem] efg-40 transition-colors hover:efg-80"
          >
            {appLabel}
            <ArrowUpRight className="h-3 w-3 transition-transform group-hover/btn:-translate-y-0.5 group-hover/btn:translate-x-0.5" />
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg eborder-06 border efg-60 transition-colors hover:efg-heading md:hidden"
          onClick={() => setIsMenuOpen((v) => !v)}
          aria-label={t("edge_toggle_navigation")}
        >
          {isMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </div>

      {/* Mobile menu */}
      {isMenuOpen && (
        <div className="eborder-04 border-t backdrop-blur-2xl md:hidden" style={{ background: `color-mix(in srgb, var(--edge-bg) 95%, transparent)` }}>
          <nav className="container edge-sans flex flex-col gap-1 py-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={
                  activePage === item.page
                    ? "rounded-lg ebg-glass-06 px-4 py-3 text-[0.9rem] font-medium efg-heading"
                    : "rounded-lg px-4 py-3 text-[0.9rem] efg-50 transition-colors hover:efg-heading"
                }
                onClick={() => setIsMenuOpen(false)}
              >
                {t(item.labelKey)}
              </Link>
            ))}
            <div className="my-2 h-px eborder-04" style={{ borderTopWidth: 0, height: 1, background: `rgba(var(--edge-fg), 0.04)` }} />
            <Link
              to={appHref}
              className="rounded-lg px-4 py-3 text-[0.9rem] efg-60 transition-colors"
              onClick={() => setIsMenuOpen(false)}
            >
              {appLabel}
            </Link>
            <div className="px-4 py-2">
              <LanguageSwitcher variant="header" />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
