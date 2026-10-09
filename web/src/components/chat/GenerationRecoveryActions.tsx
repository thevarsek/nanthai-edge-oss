import { ArrowUpRight, RefreshCw, SlidersHorizontal } from "lucide-react";
import { recoveryActionClass } from "./recoveryStyles";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { OpenRouterRecoveryDialog } from "./OpenRouterRecoveryDialog";
import type { Message } from "@/hooks/useChat";

export function GenerationRecoveryActions({ recovery, onChangeModel }: {
  recovery: Message["generationRecovery"];
  onChangeModel?: () => void;
}) {
  const { t } = useTranslation();
  const [reconnecting, setReconnecting] = useState(false);
  const actions = recovery?.actions ?? [];
  const style = recoveryActionClass;
  return <div className="-ml-3 flex flex-wrap gap-x-1" data-testid="generation-recovery">
    {actions.includes("openrouter_credits") && <a className={style} href="https://openrouter.ai/settings/credits" target="_blank" rel="noopener noreferrer">{t("generation_recovery_credits")}<ArrowUpRight size={12} aria-hidden="true"/></a>}
    {actions.includes("openrouter_keys") && <a className={style} href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">{t("funding_keys")}<ArrowUpRight size={12} aria-hidden="true"/></a>}
    {actions.includes("change_model") && onChangeModel && <button type="button" className={style} onClick={onChangeModel}><SlidersHorizontal size={14} aria-hidden="true"/>{t("generation_recovery_model")}</button>}
    {actions.includes("reconnect_openrouter") && <button type="button" className={style} onClick={() => setReconnecting(true)}><RefreshCw size={14} aria-hidden="true"/>{t("generation_recovery_reconnect")}</button>}
    {reconnecting && <OpenRouterRecoveryDialog onClose={() => setReconnecting(false)} />}
  </div>;
}
