import { Info, ShieldCheck, ArrowUpRight } from "lucide-react";
import { recoveryActionClass } from "./recoveryStyles";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { FundingGuidance } from "@/lib/modelFunding";

export function FundingNotice({ guidance, onChooseModel }: { guidance?: FundingGuidance | null; onChooseModel: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!guidance?.code || !["no_credits", "negative_balance", "key_limit", "free_zdr_unavailable", "zdr_incompatible"].includes(guidance.code)) return null;
  const actions = guidance.actions ?? [];
  const style = recoveryActionClass;
  const NoticeIcon = guidance.code === "zdr_incompatible" || guidance.code === "free_zdr_unavailable" ? ShieldCheck : Info;
  return <aside className="px-4 pb-2 pt-1 text-foreground" data-testid="funding-notice">
    <div className="flex items-start gap-2"><NoticeIcon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-foreground/60"/><p className="max-w-prose text-xs leading-relaxed text-foreground/75">{t(`funding_${guidance.code}`)}</p></div>
    <div className="mt-1 flex flex-wrap gap-x-1 pl-3">
      {actions.includes("choose_free_model") && <button type="button" className={style} onClick={onChooseModel}>{t("funding_choose_free")}</button>}
      {actions.includes("openrouter_credits") && <a className={style} href="https://openrouter.ai/settings/credits" target="_blank" rel="noopener noreferrer">{t("generation_recovery_credits")}<ArrowUpRight size={12} aria-hidden="true"/></a>}
      {actions.includes("openrouter_keys") && <a className={style} href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">{t("funding_keys")}<ArrowUpRight size={12} aria-hidden="true"/></a>}
      {actions.includes("privacy_settings") && <button type="button" className={style} onClick={() => navigate("/app/settings#chat-defaults")}>{t("funding_privacy")}</button>}
    </div>
  </aside>;
}
