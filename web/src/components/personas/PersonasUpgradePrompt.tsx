import { useTranslation } from "react-i18next";

interface PersonasUpgradePromptProps {
  onUpgrade: () => void;
}

export function PersonasUpgradePrompt({ onUpgrade }: PersonasUpgradePromptProps) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
      <div>
        <h2 className="font-semibold text-base">{t("personas_pro_feature_title")}</h2>
        <p className="text-sm text-muted mt-1 max-w-xs">
          {t("personas_pro_feature_desc")}
        </p>
      </div>
      <button
        type="button"
        onClick={onUpgrade}
        className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
      >
        {t("upgrade_to_pro")}
      </button>
    </div>
  );
}
