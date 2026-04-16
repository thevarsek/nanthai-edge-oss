// components/shared/ModelPicker.tsx
// Full model catalog picker with search, 9 sort modes, capability filters,
// info sheet, "Help me choose" wizard, provider logos, trend badges.
// Max 300 lines — heavy UI in ModelPickerHelpers.tsx, shared logic in ModelPickerShared.ts.

import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Search, X, Sparkles, Zap, DollarSign, Code2, Brain, Image as ImageIcon, Paintbrush,
  Eye, Wrench, Gift, ArrowUpDown, Info, ChevronDown, Check,
  Flame, TrendingUp, Maximize2, Video,
} from "lucide-react";
import { useModelSummaries } from "@/hooks/useSharedData";
import { ProviderLogo } from "./ProviderLogo";
import { type ModelSummary, ModelInfoSheet, ModelWizard } from "./ModelPickerHelpers";
import { formatPrice } from "./ModelPickerHelpers.utils";
import {
  type SortKey, type CapFilter, SORT_KEYS, CAP_FILTERS,
  sortMetric, filterAndSortModels, toggleCapFilter,
} from "./ModelPickerShared";

// ─── Icon maps (React elements can't live in .ts shared file) ────────────────

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

// ─── Trend badge ─────────────────────────────────────────────────────────────

function TrendBadge({ model }: { model: ModelSummary }) {
  const { t } = useTranslation();
  const useCases = model.openRouterUseCases;
  if (!useCases || useCases.length === 0) return null;
  const bestRank = Math.min(...useCases.map((uc) => uc.returnedRank));
  if (bestRank > 10) return null;
  const isPopular = bestRank <= 3;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${isPopular ? "bg-warning/12 text-warning" : "bg-foreground/8 text-muted"}`}>
      {isPopular ? <Flame size={8} /> : <TrendingUp size={8} />}
      {isPopular ? t("popular") : t("trending")}
    </span>
  );
}

// ─── Guidance label tag ──────────────────────────────────────────────────────

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

// ─── Model row ───────────────────────────────────────────────────────────────

function ModelRow({ model, selected, sortKey, onSelect, onInfo }: {
  model: ModelSummary; selected: boolean; sortKey: SortKey;
  onSelect: () => void; onInfo: () => void;
}) {
  const { t } = useTranslation();
  const score = sortMetric(model, sortKey);
  const isGuidance = !["price", "context", "topThisWeek"].includes(sortKey);
  const primaryLabel = model.derivedGuidance?.primaryLabel;

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 hover:bg-surface-3 transition-colors cursor-pointer ${selected ? "bg-primary/8" : ""}`} onClick={onSelect}>
      <ProviderLogo modelId={model.modelId} size={32} />

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate ${selected ? "text-primary" : "text-foreground"}`}>
          {model.name}
        </p>
        <div className="flex items-center gap-1 text-[10px] text-muted mt-0.5 truncate">
          <span className="capitalize">{model.provider ?? t("guidance_unknown")}</span>
          {(model.supportsVideo
            ? (model.supportedFrameImages?.length ?? 0) > 0
            : (model.architecture?.modality?.split("->")[0] ?? "").includes("image")
          ) && <Eye size={9} className="shrink-0" />}
          {model.supportsImages && <Paintbrush size={9} className="shrink-0" />}
          {model.supportsVideo && <Video size={9} className="shrink-0" />}
          {model.supportsVideo && (model.supportedFrameImages?.length ?? 0) > 0 && (
            <ImageIcon size={9} className="shrink-0" />
          )}
          {model.supportsTools && <Wrench size={9} className="shrink-0" />}
          {(model.isFree ?? model.modelId.endsWith(":free")) && <Gift size={9} className="shrink-0" />}
        </div>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          {primaryLabel && <GuidanceTag label={primaryLabel} />}
          <TrendBadge model={model} />
        </div>
      </div>

      {/* Sort score indicator */}
      {score != null && isGuidance && score > 0 && (
        <span className="text-[10px] text-muted font-mono tabular-nums shrink-0">{Math.round(score * 100)}</span>
      )}
      {score != null && sortKey === "price" && (
        <span className="text-[10px] text-muted font-mono shrink-0">{formatPrice(score)}</span>
      )}

      <button onClick={(e) => { e.stopPropagation(); onInfo(); }} className="p-1 rounded-full hover:bg-surface-2 text-muted hover:text-foreground transition-colors shrink-0" title={t("guidance_model_info")}>
        <Info size={14} />
      </button>

      {selected && <Check size={16} className="text-primary shrink-0" />}
    </div>
  );
}

// ─── Sort menu dropdown (portal to escape overflow) ──────────────────────────

function SortMenu({ sortKey, onChange }: { sortKey: SortKey; onChange: (k: SortKey) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const current = SORT_KEYS.find((s) => s.key === sortKey);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuHeight = Math.min(SORT_KEYS.length * 36 + 8, 280);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const fitsBelow = spaceBelow >= menuHeight;
    setPos({
      top: fitsBelow ? rect.bottom + 4 : rect.top - menuHeight - 4,
      left: rect.left,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const handleScroll = (e: Event) => {
      // Don't close if scrolling inside the dropdown itself
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("scroll", handleScroll, true);
    return () => { document.removeEventListener("mousedown", handleClick); window.removeEventListener("scroll", handleScroll, true); };
  }, [open]);

  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(!open)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-surface-2 text-xs font-medium text-foreground hover:bg-surface-3 transition-colors">
        <ArrowUpDown size={11} />
        {current ? t(current.labelKey) : t("sort_label")}
        <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && createPortal(
        <div ref={menuRef} className="fixed z-[9999] bg-surface-1 border border-border/50 rounded-xl shadow-lg py-1 min-w-[180px] max-h-[min(280px,calc(100vh-2rem))] overflow-y-auto" style={{ top: pos.top, left: pos.left }}>
          {SORT_KEYS.map((s) => (
            <button key={s.key} onClick={() => { onChange(s.key); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-2 transition-colors ${sortKey === s.key ? "text-primary" : "text-foreground"}`}>
              <span className="w-4">{SORT_ICONS[s.key]}</span>
              <span className="flex-1 text-left">{t(s.labelKey)}</span>
              {sortKey === s.key && <Check size={12} className="text-primary" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

// ─── Public component ────────────────────────────────────────────────────────

interface Props {
  selectedModelId: string;
  onSelect: (modelId: string) => void;
  onClose: () => void;
  title?: string;
}

export function ModelPicker({ selectedModelId, onSelect, onClose, title }: Props) {
  const { t } = useTranslation();
  const modelSummaries = useModelSummaries();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("recommended");
  const [activeFilters, setActiveFilters] = useState<Set<CapFilter>>(new Set());
  const [infoModel, setInfoModel] = useState<ModelSummary | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  const models = useMemo(
    () => (modelSummaries as ModelSummary[] | undefined) ?? [],
    [modelSummaries],
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
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <h2 className="text-base font-semibold text-foreground">{title ?? t("choose_model")}</h2>
        <button onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-muted hover:text-foreground transition-colors">
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
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Controls bar: wizard + sort + filters (horizontally scrollable, matching iOS +Controls.swift) */}
      <div className="px-4 pt-2 pb-5 overflow-x-auto overflow-y-hidden shrink-0 bg-background relative z-10">
        <div className="flex gap-1.5 min-w-max">
        {/* Help me choose */}
        <button onClick={() => setShowWizard(true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-primary/15 text-primary text-xs font-medium shrink-0 hover:bg-primary/25 transition-colors">
          <Sparkles size={11} />
          {t("help_me_choose")}
        </button>

        {/* Sort dropdown */}
        <SortMenu sortKey={sortKey} onChange={setSortKey} />

        {/* Reset chip */}
        {activeFilters.size > 0 && (
          <button onClick={() => setActiveFilters(new Set())} className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-foreground/8 text-muted text-xs font-medium shrink-0 hover:bg-foreground/12 transition-colors">
            <X size={10} />
            {t("reset_filters")}
          </button>
        )}

        {/* Capability filter chips */}
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

      {/* Divider */}
      <div className="border-b border-border/50 shrink-0" />

      {/* Model list */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/30">
        {pinnedModel && (
          <>
            <div className="px-4 py-1.5 bg-surface-2/50 text-[10px] font-medium text-muted uppercase tracking-wide">{t("selected")}</div>
            <ModelRow model={pinnedModel} selected sortKey={sortKey} onSelect={() => handleSelect(pinnedModel.modelId)} onInfo={() => setInfoModel(pinnedModel)} />
            <div className="px-4 py-1.5 bg-surface-2/50 text-[10px] font-medium text-muted uppercase tracking-wide">{t("models")}</div>
          </>
        )}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-sm text-muted gap-2">
            {models.length === 0 ? t("loading_models") : t("no_models_match")}
            {activeFilters.size > 0 && (
              <button onClick={() => setActiveFilters(new Set())} className="text-xs text-primary hover:underline">{t("clear_filters")}</button>
            )}
          </div>
        ) : (
          filtered.map((model) => (
            <ModelRow key={model.modelId} model={model} selected={model.modelId === selectedModelId}
              sortKey={sortKey} onSelect={() => handleSelect(model.modelId)} onInfo={() => setInfoModel(model)} />
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
      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowWizard(false)}>
          <div className="w-full max-w-md max-h-[85vh] rounded-2xl border border-border/50 shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <ModelWizard models={models} onSelect={handleSelect} onClose={() => setShowWizard(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
