import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowUpDown,
  Brain,
  Check,
  ChevronDown,
  Code2,
  DollarSign,
  Eye,
  Flame,
  Gift,
  Image as ImageIcon,
  Info,
  Maximize2,
  Paintbrush,
  Sparkles,
  TrendingUp,
  Video,
  Wrench,
  Zap,
} from "lucide-react";
import { ProviderLogo } from "./ProviderLogo";
import type { ModelSummary } from "./ModelPickerHelpers";
import { guidanceLabelText, listRowPriceLabel } from "./ModelPickerHelpers.utils";
import { compactMediaSummary } from "./ModelMediaCapabilities.utils";
import {
  modelIsZdrEligible,
  SORT_KEYS,
  sortMetric,
  type SortKey,
} from "./ModelPickerShared";

const SORT_ICONS: Record<SortKey, React.ReactNode> = {
  recommended: <Sparkles size={12} />,
  coding: <Code2 size={12} />,
  research: <Brain size={12} />,
  fast: <Zap size={12} />,
  value: <DollarSign size={12} />,
  image: <ImageIcon size={12} />,
  price: <span className="text-[11px] font-bold leading-none">$$</span>,
  context: <Maximize2 size={12} />,
  topThisWeek: <TrendingUp size={12} />,
};

function TrendBadge({ model }: { model: ModelSummary }) {
  const { t } = useTranslation();
  const useCases = model.openRouterUseCases;
  if (!useCases || useCases.length === 0) return null;
  const bestRank = Math.min(...useCases.map((useCase) => useCase.returnedRank));
  if (bestRank > 10) return null;
  const isPopular = bestRank <= 3;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${isPopular ? "bg-warning/12 text-warning" : "bg-foreground/8 text-muted"}`}>
      {isPopular ? <Flame size={8} /> : <TrendingUp size={8} />}
      {isPopular ? t("popular") : t("trending")}
    </span>
  );
}

function GuidanceTag({ label }: { label: string }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-primary/12 text-[9px] font-semibold text-primary">
      {guidanceLabelText(t, label)}
    </span>
  );
}

export function ModelPickerRow({
  model,
  selected,
  sortKey,
  onSelect,
  onInfo,
  zdrEnforced,
  generationKind,
}: {
  model: ModelSummary;
  selected: boolean;
  sortKey: SortKey;
  onSelect: () => void;
  onInfo: () => void;
  zdrEnforced?: boolean;
  generationKind?: keyof NonNullable<ModelSummary["generationCapabilities"]>;
}) {
  const { t } = useTranslation();
  const isZdrDisabled = zdrEnforced === true && (
    generationKind
      ? model.generationZdrCapabilities?.[generationKind] !== true
      : !modelIsZdrEligible(model)
  );
  const score = sortMetric(model, sortKey);
  const isGuidance = !["price", "context", "topThisWeek"].includes(sortKey);
  const primaryLabel = model.derivedGuidance?.primaryLabel;
  const mediaSummary = compactMediaSummary(t, model.mediaCapabilities);
  const accessibleLabel = mediaSummary.length > 0
    ? `${model.name}. ${mediaSummary.join(", ")}`
    : model.name;
  const priceLabel = listRowPriceLabel(model);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  };

  return (
    <div
      role="button"
      aria-label={accessibleLabel}
      aria-disabled={isZdrDisabled}
      tabIndex={isZdrDisabled ? undefined : 0}
      className={`flex items-center gap-3 px-4 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${isZdrDisabled ? "opacity-45 cursor-not-allowed" : "hover:bg-surface-3 cursor-pointer"} ${selected ? "bg-primary/8" : ""}`}
      onClick={isZdrDisabled ? undefined : onSelect}
      onKeyDown={isZdrDisabled ? undefined : handleKeyDown}
    >
      <ProviderLogo modelId={model.modelId} size={32} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate ${selected ? "text-primary" : "text-foreground"}`}>
          {model.name}
        </p>
        <div className="flex items-center gap-1 text-[10px] text-muted mt-0.5 truncate">
          <span className="capitalize">{model.provider ?? t("guidance_unknown")}</span>
          {(model.supportsVideo
            ? (model.supportedFrameImages?.length ?? 0) > 0
            : (model.architecture?.modality?.split("->")[0] ?? "").includes("image")) && <Eye size={9} className="shrink-0" />}
          {model.supportsImages && <Paintbrush size={9} className="shrink-0" />}
          {model.supportsVideo && <Video size={9} className="shrink-0" />}
          {model.supportsVideo && (model.supportedFrameImages?.length ?? 0) > 0 && <ImageIcon size={9} className="shrink-0" />}
          {model.supportsTools && <Wrench size={9} className="shrink-0" />}
          {(model.isFree ?? model.modelId.endsWith(":free")) && <Gift size={9} className="shrink-0" />}
        </div>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          {primaryLabel && <GuidanceTag label={primaryLabel} />}
          <TrendBadge model={model} />
        </div>
        {mediaSummary.length > 0 && (
          <p className="text-[10px] text-muted mt-0.5 truncate">{mediaSummary.join(" • ")}</p>
        )}
        {isZdrDisabled && <p className="text-[10px] text-muted mt-0.5">{t("zdr_model_not_supported")}</p>}
      </div>
      {score != null && isGuidance && score > 0 && (
        <span className="text-[10px] text-muted font-mono tabular-nums shrink-0">{Math.round(score * 100)}</span>
      )}
      {priceLabel && <span className="text-[10px] text-muted font-mono shrink-0">{priceLabel}</span>}
      <button type="button" onClick={(event) => { event.stopPropagation(); onInfo(); }} className="p-1 rounded-full hover:bg-surface-2 text-muted hover:text-foreground transition-colors shrink-0" title={t("guidance_model_info")}>
        <Info size={14} />
      </button>
      {selected && <Check size={16} className="text-primary shrink-0" />}
    </div>
  );
}

export function ModelPickerSortMenu({ sortKey, onChange }: {
  sortKey: SortKey;
  onChange: (key: SortKey) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const current = SORT_KEYS.find((sort) => sort.key === sortKey);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportPadding = 8;
    const menuHeight = Math.min(SORT_KEYS.length * 36 + 8, 280);
    const fitsBelow = window.innerHeight - rect.bottom - 8 >= menuHeight;
    const unclampedTop = fitsBelow ? rect.bottom + 4 : rect.top - menuHeight - 4;
    const menuWidth = Math.max(rect.width, 160);
    setPosition({
      top: Math.max(viewportPadding, Math.min(unclampedTop, window.innerHeight - menuHeight - viewportPadding)),
      left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (triggerRef.current?.contains(event.target as Node) || menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  return (
    <>
      <button type="button" ref={triggerRef} onClick={() => setOpen(!open)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-surface-2 text-xs font-medium text-foreground hover:bg-surface-3 transition-colors">
        <ArrowUpDown size={11} />
        {current ? t(current.labelKey) : t("sort_label")}
        <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && createPortal(
        <div ref={menuRef} className="fixed z-[9999] bg-surface-1 border border-border/50 rounded-xl shadow-lg py-1 min-w-[180px] max-h-[min(280px,calc(100vh-2rem))] overflow-y-auto" style={position}>
          {SORT_KEYS.map((sort) => (
            <button key={sort.key} type="button" onClick={() => { onChange(sort.key); setOpen(false); }} className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-2 transition-colors ${sortKey === sort.key ? "text-primary" : "text-foreground"}`}>
              <span className="w-4">{SORT_ICONS[sort.key]}</span>
              <span className="flex-1 text-left">{t(sort.labelKey)}</span>
              {sortKey === sort.key && <Check size={12} className="text-primary" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
