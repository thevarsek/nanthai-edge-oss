// components/shared/ModelPicker.tsx
// Full model catalog picker with search, 9 sort modes, capability filters,
// info sheet, "Help me choose" wizard, provider logos, trend badges.
// Max 300 lines — heavy UI in ModelPickerHelpers.tsx, shared logic in ModelPickerShared.ts.

import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Search, X, Sparkles, Paintbrush, Eye, Wrench, Gift, Video,
} from "lucide-react";
import { useModelSummaries, useSharedData } from "@/hooks/useSharedData";
import { type ModelSummary, ModelInfoSheet, ModelWizard } from "./ModelPickerHelpers";
import { ModelPickerRow, ModelPickerSortMenu } from "./ModelPickerRows";
import {
  type SortKey, type CapFilter, CAP_FILTERS,
  filterAndSortModels, modelHasTextOnlyOutput, toggleCapFilter,
} from "./ModelPickerShared";

// ─── Icon maps (React elements can't live in .ts shared file) ────────────────

const CAP_ICONS: Record<CapFilter, React.ReactNode> = {
  free: <Gift size={11} />, excludeFree: <Gift size={11} />,
  vision: <Eye size={11} />, imageGen: <Paintbrush size={11} />,
  videoGen: <Video size={11} />, tools: <Wrench size={11} />,
};

// ─── Public component ────────────────────────────────────────────────────────

interface Props {
  selectedModelId: string;
  onSelect: (modelId: string) => void;
  onClose: () => void;
  title?: string;
  textOutputOnly?: boolean;
  generationKind?: keyof NonNullable<ModelSummary["generationCapabilities"]>;
}

export function ModelPicker({
  selectedModelId,
  onSelect,
  onClose,
  title,
  textOutputOnly = false,
  generationKind,
}: Props) {
  const { t } = useTranslation();
  const modelSummaries = useModelSummaries({
    includeGenerationModels: generationKind !== undefined,
  });
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("recommended");
  const [activeFilters, setActiveFilters] = useState<Set<CapFilter>>(new Set());
  const [infoModel, setInfoModel] = useState<ModelSummary | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const { prefs } = useSharedData();
  const zdrEnforced = prefs?.zdrEnabled === true;

  const allModels = useMemo(
    () => (modelSummaries as ModelSummary[] | undefined) ?? [],
    [modelSummaries],
  );
  const models = useMemo(
    () => {
      if (generationKind) {
        return allModels.filter((model) => (
          model.generationCapabilities?.[generationKind] === true
        ));
      }
      return textOutputOnly ? allModels.filter(modelHasTextOnlyOutput) : allModels;
    },
    [allModels, generationKind, textOutputOnly],
  );
  const toggleFilter = useCallback((f: CapFilter) => {
    setActiveFilters((prev) => toggleCapFilter(prev, f));
  }, []);

  const filtered = useMemo(
    () => filterAndSortModels(models, search, sortKey, activeFilters),
    [models, search, sortKey, activeFilters],
  );

  const handleSelect = useCallback((modelId: string) => {
    onSelect(modelId);
    onClose();
  }, [onSelect, onClose]);

  // Pin the selected model at top if it's filtered out
  const pinnedModel = useMemo(() => {
    if (!selectedModelId) return null;
    if (filtered.some((m) => m.modelId === selectedModelId)) return null;
    return models.find((m) => m.modelId === selectedModelId) ?? null;
  }, [models, filtered, selectedModelId]);

  return (
    <div className="flex h-[80vh] max-h-[80vh] flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <h2 className="text-base font-semibold text-foreground">{title ?? t("choose_model")}</h2>
        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-muted hover:text-foreground transition-colors">
          <X size={18} />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 pt-3 shrink-0 bg-background">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search_models_placeholder")}
            className="w-full pl-8 pr-4 py-2 text-sm bg-surface-2 border border-border/50 rounded-xl text-foreground placeholder:text-muted focus:outline-none focus:border-primary/50" />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Controls bar: wizard + sort + filters (horizontally scrollable, matching iOS +Controls.swift) */}
      <div className="px-4 pt-2 pb-5 overflow-x-auto overflow-y-hidden shrink-0 bg-background relative z-10">
        <div className="flex gap-1.5 min-w-max">
        {/* Help me choose */}
        {generationKind === undefined && (
          <button type="button" onClick={() => setShowWizard(true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-primary/15 text-primary text-xs font-medium shrink-0 hover:bg-primary/25 transition-colors">
            <Sparkles size={11} />
            {t("help_me_choose")}
          </button>
        )}

        {/* Sort dropdown */}
        <ModelPickerSortMenu sortKey={sortKey} onChange={setSortKey} />

        {/* Reset chip */}
        {activeFilters.size > 0 && (
          <button type="button" onClick={() => setActiveFilters(new Set())} className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-foreground/8 text-muted text-xs font-medium shrink-0 hover:bg-foreground/12 transition-colors">
            <X size={10} />
            {t("reset_filters")}
          </button>
        )}

        {/* Capability filter chips */}
        {CAP_FILTERS.map((f) => {
          const active = activeFilters.has(f.key);
          return (
            <button key={f.key} type="button" onClick={() => toggleFilter(f.key)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium shrink-0 transition-colors ${active ? "bg-primary/15 text-primary" : "bg-surface-2 text-muted hover:text-foreground hover:bg-surface-3"}`}>
              {CAP_ICONS[f.key]}
              {t(f.labelKey)}
            </button>
          );
        })}
        </div>
      </div>

      {/* Divider */}
      <div className="border-b border-border/50 shrink-0" />

      {/* Model list */}
      <div data-testid="model-picker-list" className="min-h-0 flex-1 overflow-y-auto overscroll-contain divide-y divide-border/30">
        {pinnedModel && (
          <>
            <div className="px-4 py-1.5 bg-surface-2/50 text-[10px] font-medium text-muted uppercase tracking-wide">{t("selected")}</div>
            <ModelPickerRow model={pinnedModel} selected sortKey={sortKey} onSelect={() => handleSelect(pinnedModel.modelId)} onInfo={() => setInfoModel(pinnedModel)} zdrEnforced={zdrEnforced} generationKind={generationKind} />
            <div className="px-4 py-1.5 bg-surface-2/50 text-[10px] font-medium text-muted uppercase tracking-wide">{t("models")}</div>
          </>
        )}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-sm text-muted gap-2">
            {allModels.length === 0 ? t("loading_models") : t("no_models_match")}
            {activeFilters.size > 0 && (
              <button type="button" onClick={() => setActiveFilters(new Set())} className="text-xs text-primary hover:underline">{t("clear_filters")}</button>
            )}
          </div>
        ) : (
          filtered.map((model) => (
            <ModelPickerRow key={model.modelId} model={model} selected={model.modelId === selectedModelId}
              sortKey={sortKey} onSelect={() => handleSelect(model.modelId)} onInfo={() => setInfoModel(model)} zdrEnforced={zdrEnforced} generationKind={generationKind} />
          ))
        )}
      </div>

      {/* Footer count */}
      <div className="px-4 py-2 border-t border-border/50 text-[10px] text-muted text-center">
        {t(activeFilters.size > 0 ? (filtered.length === 1 ? "model_count_filtered_one" : "model_count_filtered_other") : (filtered.length === 1 ? "model_count_one" : "model_count_other"), { count: filtered.length })}
        {t("benchmark_credit")}
      </div>

      {/* Info sheet modal */}
      {infoModel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setInfoModel(null)}>
          <div className="w-full max-w-md max-h-[85vh] rounded-2xl border border-border/50 shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <ModelInfoSheet model={infoModel} onClose={() => setInfoModel(null)} />
          </div>
        </div>
      )}

      {/* Wizard modal */}
      {generationKind === undefined && showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowWizard(false)}>
          <div className="w-full max-w-md max-h-[85vh] rounded-2xl border border-border/50 shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <ModelWizard models={models} onSelect={handleSelect} onClose={() => setShowWizard(false)} zdrEnforced={zdrEnforced} />
          </div>
        </div>
      )}
    </div>
  );
}
