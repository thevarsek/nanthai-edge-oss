import { recoveryActionClass, recoveryDialogClass } from "./recoveryStyles";
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { useOpenRouterConnect } from "@/hooks/useOpenRouterConnect";

export function OpenRouterRecoveryDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const connection = useOpenRouterConnect(location.pathname + location.search + location.hash, "chat_recovery");
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onClose={onClose} aria-labelledby={title}
    className={recoveryDialogClass}>
    <div className="space-y-6">
      <h2 id={title} className="text-base font-semibold">{t("generation_recovery_reconnect")}</h2>
      {connection.errorMessage && <p role="alert" className="text-sm text-destructive">{connection.errorMessage}</p>}
      <button type="button" onClick={() => void connection.connect()} disabled={connection.isConnecting}
        className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50">
        {connection.isConnecting ? t("connecting") : t("connect_openrouter")}
      </button>
      <button type="button" onClick={() => dialog.current?.close()} className={recoveryActionClass}>{t("done")}</button>
    </div>
  </dialog>;
}
