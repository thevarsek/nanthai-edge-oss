import { WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export function OfflineBanner() {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-3 py-2 rounded-xl bg-secondary border border-border shadow-lg flex items-center gap-2 text-xs text-foreground"
    >
      <WifiOff size={14} className="text-primary" />
      <span>{t("youre_offline")}</span>
    </div>
  );
}
