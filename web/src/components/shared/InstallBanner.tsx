// web/src/components/shared/InstallBanner.tsx
// =============================================================================
// PWA install prompt banner — shown at the bottom of the screen when the app
// can be installed. Handles both Chrome/Edge native prompt and iOS Safari
// manual "Add to Home Screen" instructions.
// =============================================================================

import { Download, Share, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePWAInstall } from "@/hooks/usePWAInstall";

export function InstallBanner() {
  const { t } = useTranslation();
  const { canInstall, isIOS, showBanner, install, dismiss } = usePWAInstall();

  if (!showBanner) return null;

  return (
    <div
      role="banner"
      aria-label={t("install_nanthai_edge")}
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:max-w-sm z-40 bg-secondary border border-border rounded-2xl shadow-2xl p-4 flex items-start gap-3 animate-in slide-in-from-bottom-4 fade-in duration-300"
    >
      {/* App icon */}
      <div className="shrink-0 w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
        <span className="text-lg font-bold text-primary" aria-hidden="true">N</span>
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground leading-snug">
          {t("install_nanthai_edge")}
        </p>
        {isIOS ? (
          <p className="text-xs text-foreground/60 mt-0.5 leading-snug">
            Tap{" "}
            <Share
              className="inline w-3.5 h-3.5 -mt-0.5 text-primary"
              aria-label="Share"
            />{" "}
            then <strong>{t("add_to_home_screen_ios")}</strong>
          </p>
        ) : (
          <p className="text-xs text-foreground/60 mt-0.5 leading-snug">
            {t("add_to_home_screen_description")}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {canInstall && (
          <button
            type="button"
            onClick={async () => {
              const outcome = await install();
              if (outcome === "accepted") dismiss();
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary text-white hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Download className="w-3 h-3" aria-hidden="true" />
            {t("install")}
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("dismiss_install_prompt")}
          className="p-1.5 rounded-lg text-foreground/50 hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
