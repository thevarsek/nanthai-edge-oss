import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export type ConnectionFilterValue = "all" | "cloud" | "local";

export function ConnectionFilter({ value, onChange }: { value: ConnectionFilterValue; onChange: (value: ConnectionFilterValue) => void }) {
  const { t } = useTranslation();
  return <div role="group" aria-label={t("ai_connections")} className="flex gap-1.5 px-4 pt-3">
    {(["all", "cloud", "local"] as const).map(option => <button key={option} type="button" aria-pressed={value === option}
      onClick={() => onChange(option)} className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${value === option ? "bg-primary/15 text-primary" : "bg-surface-2 text-muted hover:bg-surface-3"}`}>
      {option === "cloud" ? "OpenRouter" : t(option === "local" ? "runtime_local" : "all")}
    </button>)}
  </div>;
}

export function LocalPersonaRecovery() {
  const { t } = useTranslation();
  return <div className="p-4 text-sm text-muted"><p>{t("runtime_no_personas")}</p>
    <Link to="/app/settings/local-runtime" className="inline-block mt-2 text-primary underline">{t("runtime_add_basic_persona")}</Link>
  </div>;
}
