import { Globe2, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AdvisorComposerOwner } from "@/hooks/useAdvisorComposer";
import { PersonaAvatar } from "@/components/shared/PersonaAvatar";

export function AdvisorComposerChips({ owner }: { owner: AdvisorComposerOwner }) {
  const { t } = useTranslation();
  if (owner.state.selections.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto border-t border-border/30 bg-surface-1 px-4 py-2 scrollbar-none">
      <button type="button" onClick={owner.open} className="flex shrink-0 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
        <Sparkles size={12} />
        {t("advisors")}
      </button>
      {owner.state.selections.map((selection) => {
        const persona = owner.selectedPersonas.find((item) => item._id === selection.personaId);
        if (!persona) return null;
        return (
          <div key={selection.personaId} className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/40 bg-surface-2 px-1.5 py-1 text-xs">
            <PersonaAvatar
              personaId={persona._id}
              personaName={persona.displayName}
              personaEmoji={persona.avatarEmoji}
              personaAvatarImageUrl={persona.avatarImageUrl}
              className="h-5 w-5"
              emojiClass="text-[10px]"
              initialClass="text-[9px]"
              iconSize={9}
            />
            <span className="max-w-28 truncate">{persona.displayName}</span>
            {selection.allowWebSearch && <Globe2 size={10} className="text-blue-400" aria-label={t("internet_access_on")} />}
            <span className="text-[9px] text-muted">{selection.keepAvailable ? t("kept") : t("once")}</span>
            <button type="button" onClick={() => void owner.remove(selection.personaId)} aria-label={t("remove_advisor", { name: persona.displayName })} className="rounded-full p-0.5 text-muted hover:bg-surface-3 hover:text-foreground">
              <X size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
