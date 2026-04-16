// ManageFavoritesHelpers.tsx
// Editor modal for creating/editing favorites.
// Supports single model, multi-model (up to 3), and persona favorites.
// Uses a unified participant picker (models + personas in one view) matching
// ChatParticipantPicker's UX instead of separate model/persona overlays.

import { useState, useMemo, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  Plus, MinusCircle, X, Search, Users, Sparkles, Zap, DollarSign,
  Code2, Brain, Image as ImageIcon, Paintbrush, Eye, Wrench, Gift, Maximize2, TrendingUp, Video,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useModelSummaries, useSharedData } from "@/hooks/useSharedData";
import { ProviderLogo } from "@/components/shared/ProviderLogo";
import { PersonaAvatar } from "@/components/shared/PersonaAvatar";
import { type ModelSummary, ModelInfoSheet, ModelWizard } from "@/components/shared/ModelPickerHelpers";
import { PersonaInfoSheet } from "@/components/shared/PersonaInfoSheet";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  type SortKey, type CapFilter, CAP_FILTERS,
  filterAndSortModels, toggleCapFilter,
  getModelOutputModality, type OutputModalityCategory,
} from "@/components/shared/ModelPickerShared";
import {
  type PersonaItem, SectionHeader, PersonaRow, ParticipantModelRow,
} from "@/components/chat/ChatParticipantPicker.helpers";
import { SortMenuPortal } from "@/components/chat/ChatParticipantPicker.sortmenu";
import { buildModelNameMap } from "@/lib/modelDisplay";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FavoriteDoc {
  _id: Id<"favorites">;
  name: string;
  modelIds: string[];
  personaId?: string;
  personaName?: string;
  personaEmoji?: string;
  personaAvatarImageUrl?: string;
  sortOrder: number;
}

type Selection =
  | { type: "model"; modelId: string }
  | { type: "persona"; personaId: string; modelId: string; name: string; emoji?: string; avatarImageUrl?: string };

const MAX_SELECTIONS = 3;

/** Human-readable label for a modality category */
function modalityLabel(m: OutputModalityCategory): string {
  switch (m) {
    case "video": return "video generation";
    case "image": return "image generation";
    default: return "text";
  }
}

type PendingModalitySwitch =
  | { kind: "model"; modelId: string; newModality: OutputModalityCategory }
  | { kind: "persona"; persona: PersonaItem; newModality: OutputModalityCategory };

// ─── Selection row (used in the editor form) ────────────────────────────────

function SelectionRow({ sel, modelName, onRemove }: { sel: Selection; modelName: string; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {sel.type === "persona" ? (
        <PersonaAvatar
          personaId={sel.personaId}
          personaName={sel.name}
          personaEmoji={sel.emoji}
          personaAvatarImageUrl={sel.avatarImageUrl}
          className="w-8 h-8"
          emojiClass="text-base"
          initialClass="text-xs"
          iconSize={14}
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
          <ProviderLogo modelId={sel.modelId} size={22} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{sel.type === "persona" ? sel.name : modelName}</p>
        <p className="text-xs text-muted truncate">
          {sel.type === "persona" ? modelName : (sel.modelId.split("/")[0] ?? "")}
        </p>
      </div>
      <button onClick={onRemove} className="text-red-400 flex-shrink-0 hover:text-red-300 transition-colors">
        <MinusCircle size={18} />
      </button>
    </div>
  );
}

// ─── Icon maps for sort & filter chips ──────────────────────────────────────

const SORT_ICONS: Record<SortKey, React.ReactNode> = {
  recommended: <Sparkles size={12} />, coding: <Code2 size={12} />,
  research: <Brain size={12} />, fast: <Zap size={12} />,
  value: <DollarSign size={12} />, image: <ImageIcon size={12} />,
  price: <span className="text-[11px] font-bold leading-none">$$</span>,
  context: <Maximize2 size={12} />, topThisWeek: <TrendingUp size={12} />,
};

const CAP_ICONS: Record<CapFilter, React.ReactNode> = {
  free: <Gift size={11} />, excludeFree: <Gift size={11} />,
  vision: <Eye size={11} />, imageGen: <Paintbrush size={11} />,
  videoGen: <Video size={11} />, tools: <Wrench size={11} />,
};

// ─── Editor Modal ───────────────────────────────────────────────────────────

export function FavoriteEditorModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: FavoriteDoc | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { personas } = useSharedData();
  const modelSummaries = useModelSummaries();
  const createFavorite = useMutation(api.favorites.mutations.createFavorite);
  const updateFavorite = useMutation(api.favorites.mutations.updateFavorite);

  // Build initial selections from existing favorite
  const buildInitialSelections = (): Selection[] => {
    if (!editing) return [];
    const sels: Selection[] = [];
    if (editing.personaId) {
      const persona = personas?.find((p) => (p._id as string) === editing.personaId);
      sels.push({
        type: "persona",
        personaId: editing.personaId,
        modelId: persona?.modelId ?? editing.modelIds[0] ?? "",
        name: editing.personaName ?? persona?.displayName ?? "Persona",
        emoji: editing.personaEmoji ?? persona?.avatarEmoji,
        avatarImageUrl: editing.personaAvatarImageUrl,
      });
      // Add remaining model IDs (skip persona's model)
      const personaModelId = persona?.modelId ?? editing.modelIds[0];
      for (const mid of editing.modelIds) {
        if (mid !== personaModelId) sels.push({ type: "model", modelId: mid });
      }
    } else {
      for (const mid of editing.modelIds) {
        sels.push({ type: "model", modelId: mid });
      }
    }
    return sels;
  };

  const [selections, setSelections] = useState<Selection[]>(buildInitialSelections);
  const [groupName, setGroupName] = useState(editing?.name ?? "");
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<PendingModalitySwitch | null>(null);

  const canAddMore = selections.length < MAX_SELECTIONS;
  const isGroup = selections.length > 1;

  const getModelName = (modelId: string) =>
    modelSummaries?.find((m) => m.modelId === modelId)?.name ?? modelId.split("/").pop() ?? modelId;

  // Auto name for single selection
  const autoName = selections.length === 1
    ? (selections[0].type === "persona" ? selections[0].name : getModelName(selections[0].modelId))
    : "";

  const resolvedName = isGroup ? groupName.trim() : (groupName.trim() || autoName);
  const canSave = selections.length >= 1 && !!resolvedName;

  const removeSelection = (idx: number) => {
    setSelections((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      // Collect modelIds — include persona's model
      const modelIds: string[] = [];
      let personaSel: Selection & { type: "persona" } | undefined;
      for (const sel of selections) {
        if (sel.type === "persona") {
          personaSel = sel;
          if (sel.modelId) modelIds.push(sel.modelId);
        } else {
          modelIds.push(sel.modelId);
        }
      }
      if (modelIds.length === 0) { setError(t("favorite_model_required")); setSaving(false); return; }

      if (editing) {
        await updateFavorite({
          favoriteId: editing._id,
          name: resolvedName,
          modelIds,
          personaId: personaSel ? (personaSel.personaId as Id<"personas">) : null,
          personaName: personaSel ? personaSel.name : null,
          personaEmoji: personaSel?.emoji ?? null,
          personaAvatarImageUrl: personaSel?.avatarImageUrl ?? null,
        });
      } else {
        await createFavorite({
          name: resolvedName,
          modelIds,
          ...(personaSel ? {
            personaId: personaSel.personaId as Id<"personas">,
            personaName: personaSel.name,
            personaEmoji: personaSel.emoji,
            personaAvatarImageUrl: personaSel.avatarImageUrl,
          } : {}),
        });
      }
      onSaved();
    } catch {
      setError(t("favorite_save_error"));
      setSaving(false);
    }
  };

  // ── Derive selected IDs for the picker ──────────────────────────────────
  const selectedModelIds = useMemo(
    () => new Set(selections.filter((s) => s.type === "model").map((s) => s.modelId)),
    [selections],
  );
  const selectedPersonaIds = useMemo(
    () => new Set(selections.filter((s) => s.type === "persona").map((s) => (s as Selection & { type: "persona" }).personaId)),
    [selections],
  );

  // ── Modality lock: once a participant is added, only same-modality allowed ─
  const models = useMemo(
    () => (modelSummaries as ModelSummary[] | undefined) ?? [],
    [modelSummaries],
  );
  const lockedModality = useMemo<OutputModalityCategory | null>(() => {
    if (selections.length === 0 || models.length === 0) return null;
    for (const sel of selections) {
      const mid = sel.modelId;
      const m = models.find((x) => x.modelId === mid);
      if (m) return getModelOutputModality(m);
    }
    return null;
  }, [selections, models]);

  // ── Toggle handlers (after models/lockedModality are defined) ───────────
  const toggleModel = useCallback((modelId: string) => {
    const exists = selections.some((s) => s.type === "model" && s.modelId === modelId);
    if (exists) {
      setSelections((prev) => prev.filter((s) => !(s.type === "model" && s.modelId === modelId)));
      return;
    }
    if (selections.length >= MAX_SELECTIONS) return;
    if (lockedModality) {
      const m = models.find((x) => x.modelId === modelId);
      if (m && getModelOutputModality(m) !== lockedModality) {
        setPendingSwitch({ kind: "model", modelId, newModality: getModelOutputModality(m) });
        return;
      }
    }
    setSelections((prev) => [...prev, { type: "model", modelId }]);
  }, [selections, lockedModality, models]);

  const togglePersona = useCallback((persona: PersonaItem) => {
    const pid = persona._id as string;
    const exists = selections.some((s) => s.type === "persona" && (s as Selection & { type: "persona" }).personaId === pid);
    if (exists) {
      setSelections((prev) => prev.filter((s) => !(s.type === "persona" && (s as Selection & { type: "persona" }).personaId === pid)));
      return;
    }
    if (selections.length >= MAX_SELECTIONS) return;
    // Check modality mismatch
    const personaModelId = persona.modelId ?? "";
    if (lockedModality && personaModelId) {
      const m = models.find((x) => x.modelId === personaModelId);
      if (m && getModelOutputModality(m) !== lockedModality) {
        setPendingSwitch({ kind: "persona", persona, newModality: getModelOutputModality(m) });
        return;
      }
    }
    setSelections((prev) => [...prev, {
      type: "persona",
      personaId: pid,
      modelId: personaModelId,
      name: persona.displayName,
      emoji: persona.avatarEmoji,
      avatarImageUrl: persona.avatarImageUrl,
    }]);
  }, [selections, lockedModality, models]);

  // ── Modality switch confirmation handler ──────────────────────────────
  const handleConfirmModalitySwitch = useCallback(() => {
    if (!pendingSwitch) return;
    const newModality = pendingSwitch.newModality;
    // Remove all selections that don't match the new modality
    setSelections((prev) => {
      const filtered = prev.filter((sel) => {
        const m = models.find((x) => x.modelId === sel.modelId);
        const selModality = m ? getModelOutputModality(m) : "text";
        return selModality === newModality;
      });
      // Add the new selection
      if (pendingSwitch.kind === "model") {
        return [...filtered, { type: "model" as const, modelId: pendingSwitch.modelId }];
      } else {
        const persona = pendingSwitch.persona;
        return [...filtered, {
          type: "persona" as const,
          personaId: persona._id as string,
          modelId: persona.modelId ?? "",
          name: persona.displayName,
          emoji: persona.avatarEmoji,
          avatarImageUrl: persona.avatarImageUrl,
        }];
      }
    });
    setPendingSwitch(null);
  }, [pendingSwitch, models]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-surface-1 rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <button onClick={onClose} className="text-sm text-muted hover:text-primary transition-colors">{t("cancel")}</button>
          <h3 className="text-base font-semibold">{editing ? t("edit_favorite") : t("new_favorite")}</h3>
          <button
            onClick={() => void handleSave()}
            disabled={!canSave || saving}
            className="text-sm font-semibold text-accent disabled:opacity-40 transition-opacity"
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Participants section */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted uppercase tracking-wide">{t("participants_label")}</span>
              <span className="text-xs text-muted">{selections.length}/{MAX_SELECTIONS}</span>
            </div>
            <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
              {selections.map((sel, idx) => (
                <SelectionRow
                  key={sel.type === "persona" ? `p-${sel.personaId}` : `m-${sel.modelId}`}
                  sel={sel}
                  modelName={getModelName(sel.type === "persona" ? sel.modelId : sel.modelId)}
                  onRemove={() => removeSelection(idx)}
                />
              ))}
              {selections.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <p className="text-sm text-muted">{t("select_models_or_personas")}</p>
                </div>
              )}
              {canAddMore && (
                <div className="flex gap-2 px-4 py-3">
                  <button
                    onClick={() => setShowPicker(true)}
                    className="flex items-center gap-1.5 text-sm text-accent hover:text-accent/80 transition-colors"
                  >
                    <Plus size={14} /> {t("add_model_or_persona")}
                  </button>
                </div>
              )}
            </div>
            <p className="text-xs text-muted px-1">
              {selections.length === 0
                ? t("favorite_zero_hint")
                : selections.length === 1
                  ? t("favorite_single_hint")
                  : ""}
            </p>
          </div>

          {/* Group name — only for multi-selections */}
          {isGroup && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted uppercase tracking-wide">{t("group_name_label")}</label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={t("group_name_placeholder")}
                className="w-full px-3 py-2 rounded-xl bg-surface-2 border border-border/50 text-sm focus:outline-none focus:border-accent"
              />
              <p className="text-xs text-muted px-1">{t("group_name_footer")}</p>
            </div>
          )}

          {/* Single selection custom name (optional) */}
          {selections.length === 1 && (
            <div className="space-y-1">
              <label className="text-xs text-muted">
                {t("favorite_name_label")} <span className="text-muted/60">({t("favorite_auto_prefix")}{autoName || "—"})</span>
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={autoName || t("favorite_name_placeholder")}
                className="w-full px-3 py-2 rounded-xl bg-surface-2 border border-border/50 text-sm focus:outline-none focus:border-accent"
              />
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      </div>

      {/* Unified participant picker overlay (models + personas in one view) */}
      {showPicker && (
        <FavoriteParticipantPicker
          selectedModelIds={selectedModelIds}
          selectedPersonaIds={selectedPersonaIds}
          atLimit={!canAddMore}
          onToggleModel={toggleModel}
          onTogglePersona={togglePersona}
          onClose={() => setShowPicker(false)}
        />
      )}

      {/* Modality switch confirmation dialog */}
      <ConfirmDialog
        isOpen={pendingSwitch != null}
        onClose={() => setPendingSwitch(null)}
        onConfirm={handleConfirmModalitySwitch}
        title={t("modality_switch_title", { var1: pendingSwitch ? modalityLabel(pendingSwitch.newModality) : "" })}
        description={t("modality_switch_description", {
          var1: lockedModality ? modalityLabel(lockedModality) : "",
          var2: pendingSwitch ? modalityLabel(pendingSwitch.newModality) : "",
        })}
        confirmLabel={t("modality_switch_confirm")}
        confirmVariant="default"
      />
    </div>
  );
}

// ─── Unified participant picker for favorites ───────────────────────────────
// Mirrors ChatParticipantPicker layout: search, sort/filter controls, personas
// section, models section — all in one scrollable view with multi-select toggle.

function FavoriteParticipantPicker({
  selectedModelIds,
  selectedPersonaIds,
  atLimit,
  onToggleModel,
  onTogglePersona,
  onClose,
}: {
  selectedModelIds: Set<string>;
  selectedPersonaIds: Set<string>;
  atLimit: boolean;
  onToggleModel: (modelId: string) => void;
  onTogglePersona: (persona: PersonaItem) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { personas } = useSharedData();
  const modelSummaries = useModelSummaries();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("recommended");
  const [activeFilters, setActiveFilters] = useState<Set<CapFilter>>(new Set());
  const [infoModel, setInfoModel] = useState<ModelSummary | null>(null);
  const [infoPersona, setInfoPersona] = useState<PersonaItem | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  const models = useMemo(
    () => (modelSummaries as ModelSummary[] | undefined) ?? [],
    [modelSummaries],
  );
  const query = search.toLowerCase().trim();
  const modelNameMap = useMemo(
    () => buildModelNameMap(modelSummaries as Parameters<typeof buildModelNameMap>[0]),
    [modelSummaries],
  );

  const filteredPersonas = useMemo<PersonaItem[]>(() => {
    if (!personas) return [];
    const list = (personas as PersonaItem[]).filter((p) =>
      query ? p.displayName.toLowerCase().includes(query) : true,
    );
    return list.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [personas, query]);

  const filteredModels = useMemo(
    () => filterAndSortModels(models, search, sortKey, activeFilters),
    [models, search, sortKey, activeFilters],
  );

  const toggleFilter = useCallback((f: CapFilter) => {
    setActiveFilters((prev) => toggleCapFilter(prev, f));
  }, []);

  const handleWizardSelect = useCallback(
    (modelId: string) => {
      if (!atLimit && !selectedModelIds.has(modelId)) {
        onToggleModel(modelId);
      }
      setShowWizard(false);
    },
    [atLimit, onToggleModel, selectedModelIds],
  );

  const selectionCount = selectedModelIds.size + selectedPersonaIds.size;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg max-h-[85vh] bg-surface-1 rounded-t-2xl sm:rounded-2xl border border-border/50 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-primary" />
            <span className="text-base font-semibold">{t("participants")}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted font-medium">
              {selectionCount}/{MAX_SELECTIONS}
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
          {/* Personas section */}
          {filteredPersonas.length > 0 && (
            <div>
              <SectionHeader title={t("personas")} count={filteredPersonas.length} className="pt-2" />
              {filteredPersonas.map((p) => (
                <PersonaRow
                  key={p._id}
                  persona={p}
                  isSelected={selectedPersonaIds.has(p._id as string)}
                  disabled={atLimit && !selectedPersonaIds.has(p._id as string)}
                  onToggle={onTogglePersona}
                  onInfo={setInfoPersona}
                  modelNameMap={modelNameMap}
                />
              ))}
            </div>
          )}

          {/* Models section */}
          <div className={filteredPersonas.length > 0 ? "border-t border-border/30" : ""}>
            <SectionHeader title={t("models")} count={filteredModels.length} className="pt-2" />
            {filteredModels.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 text-sm text-muted gap-2">
                {models.length === 0 ? t("loading_models") : t("no_models_match")}
                {activeFilters.size > 0 && (
                  <button onClick={() => setActiveFilters(new Set())} className="text-xs text-primary hover:underline">{t("clear_filters")}</button>
                )}
              </div>
            ) : (
              filteredModels.map((model) => {
                return (
                  <ParticipantModelRow
                    key={model.modelId}
                    model={model}
                    isSelected={selectedModelIds.has(model.modelId)}
                    disabled={atLimit && !selectedModelIds.has(model.modelId)}
                    sortKey={sortKey}
                    onToggle={onToggleModel}
                    onInfo={setInfoModel}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border/50 text-[10px] text-muted text-center shrink-0">
          {t("select_up_to_arg_participants", { var1: MAX_SELECTIONS })}
        </div>

        {/* Info sheet modal */}
        {infoModel && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setInfoModel(null)}>
            <div className="w-full max-w-md max-h-[85vh] rounded-2xl border border-border/50 shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <ModelInfoSheet model={infoModel} onClose={() => setInfoModel(null)} />
            </div>
          </div>
        )}

        {infoPersona && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setInfoPersona(null)}>
            <div className="w-full max-w-md max-h-[85vh] rounded-2xl border border-border/50 shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <PersonaInfoSheet persona={infoPersona} onClose={() => setInfoPersona(null)} />
            </div>
          </div>
        )}

        {/* Wizard modal */}
        {showWizard && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowWizard(false)}>
            <div className="w-full max-w-md max-h-[85vh] rounded-2xl border border-border/50 shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <ModelWizard models={models} onSelect={handleWizardSelect} onClose={() => setShowWizard(false)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
