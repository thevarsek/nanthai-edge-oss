import { Link } from "react-router-dom";
import { Building2, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

// ─── Component ─────────────────────────────────────────────────────────────

export function ProvidersSection() {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl bg-surface-2 overflow-hidden">
      <Link
        to="/app/settings/providers"
        className="flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors"
      >
        <span className="text-primary flex-shrink-0">
          <Building2 size={18} />
        </span>
        <span className="flex-1 text-sm">{t("enabled_providers")}</span>
        <ChevronRight size={14} className="text-muted flex-shrink-0" />
      </Link>
    </div>
  );
}
