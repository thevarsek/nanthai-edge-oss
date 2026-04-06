import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";

const EDGE_DEEP_LINK_BASE = "nanthai-edge://auth/callback";

export function OpenRouterCallbackPage() {
  const { t } = useTranslation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const deepLink = `${EDGE_DEEP_LINK_BASE}${search}`;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.location.replace(deepLink);
  }, [deepLink]);

  return (
    <>
      <Helmet>
        <title>Redirecting to NanthAI Edge</title>
        <meta httpEquiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
        <meta name="robots" content="noindex, nofollow, noarchive" />
      </Helmet>
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold text-white">{t("opening_nanthai_edge")}</h1>
          <p className="text-sm text-white/60">
            {t("if_app_not_open")}
          </p>
          <a
            href={deepLink}
            className="inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-medium text-[#05101f] hover:bg-white/90"
          >
            {t("open_nanthai_edge")}
          </a>
          <noscript>
            <p className="text-sm text-white/60">
              {t("open_manually_noscript")}
            </p>
          </noscript>
        </div>
      </div>
    </>
  );
}
