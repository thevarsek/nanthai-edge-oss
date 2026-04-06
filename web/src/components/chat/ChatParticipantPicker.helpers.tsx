// components/chat/ChatParticipantPicker.helpers.tsx
// Sub-components for ChatParticipantPicker: SelectedSection, PersonaRow,
// ParticipantModelRow, SectionHeader. Keeps main file under 300 lines.

import {
  MinusCircle, Info, Check, Eye, Wrench, Gift,
  Flame, TrendingUp,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProviderLogo } from "@/components/shared/ProviderLogo";
import { PersonaAvatar } from "@/components/shared/PersonaAvatar";
import { sortMetric, type SortKey } from "@/components/shared/ModelPickerShared";
import { type ModelSummary } from "@/components/shared/ModelPickerHelpers";
import { formatPrice } from "@/components/shared/ModelPickerHelpers.utils";
import type { ParticipantEntry } from "@/hooks/useParticipants";
import type { Id } from "@convex/_generated/dataModel";
import { getModelDisplayName } from "@/lib/modelDisplay";

// ─── Persona type (matches shape from useSharedData) ─────────────────────────

export interface PersonaItem {
  _id: Id<"personas">;
  displayName: string;
  personaDescription?: string;
  systemPrompt?: string;
  modelId?: string;
  avatarEmoji?: string;
  avatarImageUrl?: string;
  temperature?: number;
  maxTokens?: number;
  includeReasoning?: boolean;
  reasoningEffort?: string;
}

// ─── Section header ──────────────────────────────────────────────────────────

export function SectionHeader({
  title,
  count,
  className,
}: {
  title: string;
  count?: number;
  className?: string;
}) {
  return (
    <div className={`px-4 py-1.5 text-[10px] font-medium text-muted uppercase tracking-wider ${className ?? ""}`}>
      {title}{count != null ? ` (${count})` : ""}
    </div>
  );
}

// ─── Selected section ────────────────────────────────────────────────────────

export function SelectedSection({
  participants,
  onRemove,
  modelNameMap,
}: {
  participants: ParticipantEntry[];
  onRemove: (id: Id<"chatParticipants">) => void;
  modelNameMap: Map<string, string>;
}) {
  const { t } = useTranslation();
  const canRemove = participants.length > 1;
  return (
    <div className="py-1">
      <SectionHeader title={t("selected")} />
      {participants.map((p) => (
        <SelectedRow key={p.id} participant={p} canRemove={canRemove} onRemove={onRemove} modelNameMap={modelNameMap} />
      ))}
      <p className="px-4 py-1 text-[10px] text-muted">
        {t("tap_selected_to_remove")}
      </p>
    </div>
  );
}

function SelectedRow({
  participant,
  canRemove,
  onRemove,
  modelNameMap,
}: {
  participant: ParticipantEntry;
  canRemove: boolean;
  onRemove: (id: Id<"chatParticipants">) => void;
  modelNameMap: Map<string, string>;
}) {
  const { t } = useTranslation();
  const label = participant.personaName ?? getModelDisplayName(participant.modelId, modelNameMap);
  const subtitle = participant.personaName
    ? getModelDisplayName(participant.modelId, modelNameMap)
    : participant.modelId.split("/")[0] ?? "";

  return (
    <div className="flex items-center gap-3 px-4 py-2 hover:bg-surface-2 transition-colors">
      {/* Avatar */}
      {participant.personaId || participant.personaEmoji || participant.personaAvatarImageUrl ? (
        <PersonaAvatar
          personaId={participant.personaId || undefined}
          personaName={participant.personaName || undefined}
          personaEmoji={participant.personaEmoji ?? undefined}
          personaAvatarImageUrl={participant.personaAvatarImageUrl ?? undefined}
          className="w-9 h-9"
          emojiClass="text-lg"
          initialClass="text-sm"
          iconSize={16}
        />
      ) : (
        <ProviderLogo modelId={participant.modelId} size={36} />
      )}

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{label}</p>
        {subtitle && <p className="text-[11px] text-muted truncate">{subtitle}</p>}
      </div>

      {/* Remove button */}
      <button
        onClick={() => canRemove && onRemove(participant.id)}
        disabled={!canRemove}
        className={`p-0.5 rounded-full transition-colors ${canRemove ? "text-red-400 hover:text-red-300" : "text-muted opacity-30"}`}
        title={canRemove ? t("remove_participant") : t("cannot_remove_last_participant")}
      >
        <MinusCircle size={18} />
      </button>
    </div>
  );
}

// ─── Persona row ─────────────────────────────────────────────────────────────

export function PersonaRow({
  persona,
  isSelected,
  disabled,
  onToggle,
  onInfo,
  modelNameMap,
}: {
  persona: PersonaItem;
  isSelected: boolean;
  disabled: boolean;
  onToggle: (p: PersonaItem) => void;
  onInfo: (p: PersonaItem) => void;
  modelNameMap: Map<string, string>;
}) {
  const { t } = useTranslation();
  const modelShort = persona.modelId ? getModelDisplayName(persona.modelId, modelNameMap) : "";
  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
        disabled && !isSelected ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-3 cursor-pointer"
      } ${isSelected ? "bg-primary/8" : ""}`}
      onClick={() => !disabled && onToggle(persona)}
    >
      {/* Avatar */}
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

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${isSelected ? "text-primary" : ""}`}>
          {persona.displayName}
        </p>
        {modelShort && (
          <p className="text-[11px] text-muted truncate">{modelShort}</p>
        )}
      </div>

      {/* Info button */}
      <button
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

// ─── Trend badge (shared with ModelPicker) ───────────────────────────────────

function TrendBadge({ model }: { model: ModelSummary }) {
  const { t } = useTranslation();
  const useCases = model.openRouterUseCases;
  if (!useCases || useCases.length === 0) return null;
  const bestRank = Math.min(...useCases.map((uc) => uc.returnedRank));
  if (bestRank > 10) return null;
  const isPopular = bestRank <= 3;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${isPopular ? "bg-orange-500/12 text-orange-400" : "bg-foreground/8 text-muted"}`}>
      {isPopular ? <Flame size={8} /> : <TrendingUp size={8} />}
      {isPopular ? t("popular") : t("trending")}
    </span>
  );
}

function GuidanceTag({ label }: { label: string }) {
  const { t } = useTranslation();
  const LABEL_MAP: Record<string, string> = {
    "recommended.best": t("best_overall"), "recommended.top": t("top_pick"),
    "coding.best": t("best_for_coding"), "coding.top": t("great_for_coding"),
    "research.best": t("best_for_research"), "research.top": t("great_for_research"),
    "fast.best": t("fast_replies"), "fast.top": t("fast_replies"),
    "value.best": t("best_value"), "value.top": t("great_value"),
    "image.best": t("top_image_model"), "image.top": t("top_image_model"),
  };
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-primary/12 text-[9px] font-semibold text-primary">
      {LABEL_MAP[label] ?? label}
    </span>
  );
}

// ─── Model row (for participant picker — includes info button + badges) ──────

export function ParticipantModelRow({
  model,
  isSelected,
  disabled,
  sortKey,
  onToggle,
  onInfo,
}: {
  model: ModelSummary;
  isSelected: boolean;
  disabled: boolean;
  sortKey: SortKey;
  onToggle: (modelId: string) => void;
  onInfo: (model: ModelSummary) => void;
}) {
  const { t } = useTranslation();
  const score = sortMetric(model, sortKey);
  const isGuidance = !["price", "context", "topThisWeek"].includes(sortKey);
  const primaryLabel = model.derivedGuidance?.primaryLabel;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
        disabled && !isSelected ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-3 cursor-pointer"
      } ${isSelected ? "bg-primary/8" : ""}`}
      onClick={() => !disabled && onToggle(model.modelId)}
    >
      <ProviderLogo modelId={model.modelId} size={36} />

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate ${isSelected ? "text-primary" : ""}`}>
          {model.name}
        </p>
        <div className="flex items-center gap-1 text-[10px] text-muted mt-0.5 truncate">
          <span className="capitalize">{model.provider ?? t("guidance_unknown")}</span>
          {model.supportsImages && <Eye size={9} className="shrink-0" />}
          {model.supportsTools && <Wrench size={9} className="shrink-0" />}
          {(model.inputPricePer1M ?? 0) === 0 && (model.outputPricePer1M ?? 0) === 0 && <Gift size={9} className="shrink-0" />}
        </div>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          {primaryLabel && <GuidanceTag label={primaryLabel} />}
          <TrendBadge model={model} />
        </div>
      </div>

      {/* Sort score */}
      {score != null && isGuidance && score > 0 && (
        <span className="text-[10px] text-muted font-mono tabular-nums shrink-0">{Math.round(score * 100)}</span>
      )}
      {score != null && sortKey === "price" && (
        <span className="text-[10px] text-muted font-mono shrink-0">{formatPrice(score)}</span>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onInfo(model); }}
        className="p-1 rounded-full hover:bg-surface-2 text-muted hover:text-foreground transition-colors shrink-0"
        title={t("model_info")}
      >
        <Info size={14} />
      </button>

      {isSelected && <Check size={16} className="text-primary shrink-0" />}
    </div>
  );
}
