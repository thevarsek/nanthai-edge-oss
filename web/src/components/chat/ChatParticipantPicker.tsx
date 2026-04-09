// components/chat/ChatParticipantPicker.tsx
// Multi-select participant picker with full ModelPicker features: 9 sort modes,
// 5 capability filters, "Help me choose" wizard, model info sheet, provider logos,
// trend badges, guidance tags. Mirrors iOS UnifiedParticipantPickerView.
// Sub-components in ChatParticipantPicker.helpers.tsx.

import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  X, Search, Users, Sparkles, Zap, DollarSign, Code2, Brain, Image,
  Eye, Wrench, Gift, Maximize2, TrendingUp,
} from "lucide-react";
import { useModelSummaries, useSharedData } from "@/hooks/useSharedData";
import type { Id } from "@convex/_generated/dataModel";
import type { ParticipantEntry } from "@/hooks/useParticipants";
import { type ModelSummary, ModelInfoSheet, ModelWizard } from "@/components/shared/ModelPickerHelpers";
import { PersonaInfoSheet } from "@/components/shared/PersonaInfoSheet";
import {
  type SortKey, type CapFilter, CAP_FILTERS,
  filterAndSortModels, toggleCapFilter,
} from "@/components/shared/ModelPickerShared";
import {
  type PersonaItem, SelectedSection, SectionHeader,
  PersonaRow, ParticipantModelRow,
} from "./ChatParticipantPicker.helpers";
import { Defaults } from "@/lib/constants";
import { SortMenuPortal } from "./ChatParticipantPicker.sortmenu";
import { buildModelNameMap } from "@/lib/modelDisplay";

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  chatId: Id<"chats">;
  participants: ParticipantEntry[];
  onAdd: (args: {
    chatId: Id<"chats">;
    modelId: string;
    personaId?: Id<"personas">;
    personaName?: string;
    personaEmoji?: string | null;
    personaAvatarImageUrl?: string | null;
  }) => Promise<unknown>;
  onRemove: (participantId: Id<"chatParticipants">) => Promise<void>;
  onClose: () => void;
}

// ─── Icon maps ──────────────────────────────────────────────────────────────

const SORT_ICONS: Record<SortKey, React.ReactNode> = {
  recommended: <Sparkles size={12} />, coding: <Code2 size={12} />,
  research: <Brain size={12} />, fast: <Zap size={12} />,
  value: <DollarSign size={12} />, image: <Image size={12} />,
  price: <span className="text-[11px] font-bold leading-none">$$</span>,
  context: <Maximize2 size={12} />, topThisWeek: <TrendingUp size={12} />,
};

const CAP_ICONS: Record<CapFilter, React.ReactNode> = {
  free: <Gift size={11} />, excludeFree: <Gift size={11} />,
  vision: <Eye size={11} />, imageGen: <Image size={11} />,
  tools: <Wrench size={11} />,
};

// ─── Component ──────────────────────────────────────────────────────────────

export function ChatParticipantPicker({
  chatId,
  participants,
  onAdd,
  onRemove,
  onClose,
}: Props) {
  const { personas } = useSharedData();
  const modelSummaries = useModelSummaries();
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("recommended");
  const [activeFilters, setActiveFilters] = useState<Set<CapFilter>>(new Set());
  const [infoModel, setInfoModel] = useState<ModelSummary | null>(null);
  const [infoPersona, setInfoPersona] = useState<PersonaItem | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  const atLimit = participants.length >= Defaults.maxParticipants;
  const models = useMemo(
    () => (modelSummaries as ModelSummary[] | undefined) ?? [],
    [modelSummaries],
  );
  const query = search.toLowerCase().trim();
  const modelNameMap = useMemo(
    () => buildModelNameMap(modelSummaries as Parameters<typeof buildModelNameMap>[0]),
    [modelSummaries],
  );

  // ── Already-selected IDs ────────────────────────────────────────────────
  const selectedPersonaIds = useMemo(
    () => new Set(participants.filter((p) => p.personaId).map((p) => p.personaId as string)),
    [participants],
  );
  const selectedModelIds = useMemo(
    () => new Set(participants.filter((p) => !p.personaId).map((p) => p.modelId)),
    [participants],
  );

  // ── Filtered personas ───────────────────────────────────────────────────
  const filteredPersonas = useMemo<PersonaItem[]>(() => {
    if (!personas) return [];
    const list = (personas as PersonaItem[]).filter((p) =>
      query ? p.displayName.toLowerCase().includes(query) : true,
    );
    return list.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [personas, query]);

  // ── Filtered & sorted models (reuses shared pipeline) ───────────────────
  const filteredModels = useMemo(
    () => filterAndSortModels(models, search, sortKey, activeFilters),
    [models, search, sortKey, activeFilters],
  );

  // ── Toggle handlers ─────────────────────────────────────────────────────
  const toggleFilter = useCallback((f: CapFilter) => {
    setActiveFilters((prev) => toggleCapFilter(prev, f));
  }, []);

  const handleTogglePersona = useCallback(
    (p: PersonaItem) => {
      if (selectedPersonaIds.has(p._id)) {
        const part = participants.find((x) => x.personaId === p._id);
        if (part && participants.length > 1) void onRemove(part.id);
      } else if (!atLimit) {
        void onAdd({
          chatId,
          modelId: p.modelId ?? Defaults.model,
          personaId: p._id,
          personaName: p.displayName,
          personaEmoji: p.avatarEmoji ?? null,
          personaAvatarImageUrl: p.avatarImageUrl ?? null,
        });
      }
    },
    [chatId, atLimit, onAdd, onRemove, participants, selectedPersonaIds],
  );

  const handleToggleModel = useCallback(
    (modelId: string) => {
      if (selectedModelIds.has(modelId)) {
        const part = participants.find((x) => !x.personaId && x.modelId === modelId);
        if (part && participants.length > 1) void onRemove(part.id);
      } else if (!atLimit) {
        void onAdd({ chatId, modelId });
      }
    },
    [chatId, atLimit, onAdd, onRemove, participants, selectedModelIds],
  );

  const handleWizardSelect = useCallback(
    (modelId: string) => {
      if (!atLimit && !selectedModelIds.has(modelId)) {
        void onAdd({ chatId, modelId });
      }
      setShowWizard(false);
    },
    [chatId, atLimit, onAdd, selectedModelIds],
  );

  const handleRemove = useCallback(
    (id: Id<"chatParticipants">) => {
      if (participants.length > 1) void onRemove(id);
    },
    [participants.length, onRemove],
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] bg-surface-1 rounded-t-2xl sm:rounded-2xl border border-border/50 shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-primary" />
            <span className="text-base font-semibold">{t("participants")}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted font-medium">
              {participants.length}/{Defaults.maxParticipants}
            </span>
            <button onClick={onClose} className="p-1 rounded hover:bg-surface-2 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 pt-3 shrink-0 bg-surface-1">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={t("search_models_and_personas")}
              className="w-full pl-8 pr-4 py-2 text-sm bg-surface-2 border border-border/50 rounded-xl text-foreground placeholder-muted focus:outline-none focus:border-primary/50"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Controls bar */}
        <div className="px-4 pt-2 pb-5 overflow-x-auto overflow-y-hidden shrink-0 bg-surface-1 relative z-10">
          <div className="flex gap-1.5 min-w-max">
          <button onClick={() => setShowWizard(true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-primary/15 text-primary text-xs font-medium shrink-0 hover:bg-primary/25 transition-colors">
            <Sparkles size={11} />
            {t("help_me_choose")}
          </button>
          <SortMenuPortal sortKey={sortKey} onChange={setSortKey} sortIcons={SORT_ICONS} />
          {activeFilters.size > 0 && (
            <button onClick={() => setActiveFilters(new Set())} className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-foreground/8 text-muted text-xs font-medium shrink-0 hover:bg-foreground/12 transition-colors">
              <X size={10} /> {t("reset")}
            </button>
          )}
          {CAP_FILTERS.map((f) => {
            const active = activeFilters.has(f.key);
            return (
              <button key={f.key} onClick={() => toggleFilter(f.key)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium shrink-0 transition-colors ${active ? "bg-primary/15 text-primary" : "bg-surface-2 text-muted hover:text-foreground hover:bg-surface-3"}`}>
                {CAP_ICONS[f.key]}
              {t(f.labelKey)}
            </button>
          );
        })}
          </div>
        </div>

        <div className="border-b border-border/50 shrink-0" />

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Selected section */}
          {participants.length > 0 && (
            <SelectedSection participants={participants} onRemove={handleRemove} modelNameMap={modelNameMap} />
          )}

          {/* Personas section */}
          {filteredPersonas.length > 0 && (
            <div className="border-t border-border/30">
              <SectionHeader title={t("personas")} count={filteredPersonas.length} className="pt-2" />
              {filteredPersonas.map((p) => (
                <PersonaRow
                  key={p._id}
                  persona={p}
                  isSelected={selectedPersonaIds.has(p._id)}
                  disabled={atLimit && !selectedPersonaIds.has(p._id)}
                  onToggle={handleTogglePersona}
                  onInfo={setInfoPersona}
                  modelNameMap={modelNameMap}
                />
              ))}
            </div>
          )}

          {/* Models section */}
          <div className="border-t border-border/30">
            <SectionHeader title={t("models")} count={filteredModels.length} className="pt-2" />
            {filteredModels.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 text-sm text-muted gap-2">
                {models.length === 0 ? t("loading_models") : t("no_models_match")}
                {activeFilters.size > 0 && (
                  <button onClick={() => setActiveFilters(new Set())} className="text-xs text-primary hover:underline">{t("clear_filters")}</button>
                )}
              </div>
            ) : (
              filteredModels.map((model) => (
                <ParticipantModelRow
                  key={model.modelId}
                  model={model}
                  isSelected={selectedModelIds.has(model.modelId)}
                  disabled={atLimit && !selectedModelIds.has(model.modelId)}
                  sortKey={sortKey}
                  onToggle={handleToggleModel}
                  onInfo={setInfoModel}
                />
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border/50 text-[10px] text-muted text-center">
          {t("select_up_to_arg_participants", { var1: Defaults.maxParticipants })}
        </div>

        {/* Info sheet modal */}
        {infoModel && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setInfoModel(null)}>
            <div className="w-full max-w-md max-h-[85vh] rounded-2xl border border-border/50 shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <ModelInfoSheet model={infoModel} onClose={() => setInfoModel(null)} />
            </div>
          </div>
        )}

        {infoPersona && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setInfoPersona(null)}>
            <div className="w-full max-w-md max-h-[85vh] rounded-2xl border border-border/50 shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <PersonaInfoSheet persona={infoPersona} onClose={() => setInfoPersona(null)} />
            </div>
          </div>
        )}

        {/* Wizard modal */}
        {showWizard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowWizard(false)}>
            <div className="w-full max-w-md max-h-[85vh] rounded-2xl border border-border/50 shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <ModelWizard models={models} onSelect={handleWizardSelect} onClose={() => setShowWizard(false)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
