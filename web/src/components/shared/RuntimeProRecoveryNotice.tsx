import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useOpenRouterStatus, useSharedData } from "@/hooks/useSharedData";

/** Keep previously paired free users' history and device management accessible. */
export function RuntimeProRecoveryNotice() {
  const { prefs, proStatus } = useSharedData();
  const hasApiKey = useOpenRouterStatus();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  if (!prefs?.runtimeOnboardingState || !proStatus || proStatus.isPro || hasApiKey !== false || pathname === "/app/settings/local-runtime") return null;
  return <aside className="shrink-0 border-b border-border px-4 py-3 text-sm space-y-2">
    <p>{t("runtime_pro_purchase_help")}</p>
    <div className="flex flex-wrap gap-4">
      <Link className="underline" to="/app/settings/local-runtime">{t("get_nanthai_pro")}</Link>
      <Link className="underline" to="/onboarding?mode=connections">{t("connect_openrouter")}</Link>
    </div>
  </aside>;
}
