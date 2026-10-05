import { Check, Info, Laptop } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PersonaAvatar } from "@/components/shared/PersonaAvatar";
import { isProviderAllowedForGoogle } from "@/components/shared/ModelPickerShared";
import { getModelDisplayName } from "@/lib/modelDisplay";
import type { PersonaItem } from "./ChatParticipantPicker.helpers";
import { activateRowFromKeyboard } from "./ChatParticipantPicker.utils";

export function PersonaRow({
  persona,
  isSelected,
  disabled,
  onToggle,
  onInfo,
  modelNameMap,
  zdrEnforced,
  modelZdrMap,
  googleIntegrationsActive,
  modelProviderMap,
  fallbackModelId,
}: {
  persona: PersonaItem;
  isSelected: boolean;
  disabled: boolean;
  onToggle: (p: PersonaItem) => void;
  onInfo: (p: PersonaItem) => void;
  modelNameMap: Map<string, string>;
  zdrEnforced?: boolean;
  modelZdrMap?: Map<string, boolean>;
  googleIntegrationsActive?: boolean;
  modelProviderMap?: Map<string, string>;
  fallbackModelId?: string;
}) {
  const { t } = useTranslation();
  const effectiveModelId = persona.modelId ?? fallbackModelId;
  const modelShort = effectiveModelId ? getModelDisplayName(effectiveModelId, modelNameMap) : "";
  const isZdrBlocked = zdrEnforced === true && effectiveModelId != null && modelZdrMap != null && !modelZdrMap.get(effectiveModelId);
  const personaProvider = effectiveModelId && modelProviderMap ? modelProviderMap.get(effectiveModelId) : undefined;
  const isGoogleBlocked = googleIntegrationsActive === true && effectiveModelId != null && (
    !modelZdrMap?.get(effectiveModelId) ||
    !isProviderAllowedForGoogle(effectiveModelId, personaProvider)
  );
  const isDisabled = disabled || isZdrBlocked || isGoogleBlocked;
  const disabledReason = isZdrBlocked ? t("zdr_model_not_supported") : isGoogleBlocked ? t("zdr_model_not_available_google") : null;
  const canToggle = !isDisabled || isSelected;
  return (
    <div
      role="button"
      tabIndex={canToggle ? 0 : -1}
      aria-disabled={!canToggle}
      aria-pressed={isSelected}
      className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
        isDisabled && !isSelected ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-3 cursor-pointer"
      } ${isSelected ? "bg-primary/8" : ""}`}
      onClick={() => canToggle && onToggle(persona)}
      onKeyDown={(event) => activateRowFromKeyboard(event, () => canToggle && onToggle(persona))}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
      <PersonaAvatar
        personaId={persona._id}
        personaName={persona.displayName}
        personaEmoji={persona.avatarEmoji}
        personaAvatarImageUrl={persona.avatarImageUrl}
        className="w-9 h-9"
        emojiClass="text-lg"
        initialClass="text-sm"
        iconSize={16}
      />
      {persona.runtimePlacement === "local" && (
        <span aria-label={t("runtime_local")} title={t("runtime_local")}
          className="absolute -bottom-1 -right-1 rounded-full bg-surface-1 p-0.5 text-primary border border-border">
          <Laptop size={12} aria-hidden="true" />
        </span>
      )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${isSelected ? "text-primary" : ""}`}>
          {persona.displayName}
        </p>
        {modelShort && (
          <p className="text-[11px] text-muted truncate">{modelShort}</p>
        )}
        {disabledReason && (
          <p className="text-[10px] text-muted">{disabledReason}</p>
        )}
      </div>

      {/* Info button */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onInfo(persona); }}
        className="p-1 rounded-full hover:bg-surface-2 text-muted hover:text-foreground transition-colors shrink-0"
        title={t("persona_info")}
      >
        <Info size={14} />
      </button>

      {/* Selection checkmark */}
      {isSelected && <Check size={16} className="text-primary shrink-0" />}
    </div>
  );
}

