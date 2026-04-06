// components/chat/SearchModePanel.tsx
// Panel for selecting search mode (Basic/Web/Paper) and complexity (1-3).
// Mirrors iOS SearchPanelView: segmented tabs, complexity selector, cost estimates.
// Opened via right-click or long-press on the globe button in chat header.

import { useState } from "react";
import { X, Globe, Search, FileText, Zap, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "@/components/shared/SegmentedControl";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SearchModeTab = "basic" | "web" | "paper";
export type SearchComplexity = 1 | 2 | 3;

export interface SearchModeState {
  mode: "none" | "basic" | "web" | "paper";
  complexity: SearchComplexity;
}

interface Props {
  current: SearchModeState;
  onSelect: (state: SearchModeState) => void;
  onClose: () => void;
  isPro: boolean;
  isMultiModel: boolean;
}

// ─── Cost data ──────────────────────────────────────────────────────────────

const COST_INFO: Record<SearchModeTab, Record<SearchComplexity, { tier: string; cost: string; detailKey: string }>> = {
  basic: {
    1: { tier: "$", cost: "~$0.02", detailKey: "search_footer_basic" },
    2: { tier: "$", cost: "~$0.02", detailKey: "search_footer_basic" },
    3: { tier: "$", cost: "~$0.02", detailKey: "search_footer_basic" },
  },
  web: {
    1: { tier: "$", cost: "~$0.01", detailKey: "search_footer_web" },
    2: { tier: "$$", cost: "~$0.04–$0.06", detailKey: "search_footer_web" },
    3: { tier: "$$$$", cost: "~$6–$7", detailKey: "search_footer_web" },
  },
  paper: {
    1: { tier: "$$", cost: "~$0.01–$0.02", detailKey: "search_footer_research" },
    2: { tier: "$$$", cost: "~$0.08–$0.12", detailKey: "search_footer_research" },
    3: { tier: "$$$$$", cost: "~$18–$21", detailKey: "search_footer_research" },
  },
};

// ─── Component ──────────────────────────────────────────────────────────────

export function SearchModePanel({ current, onSelect, onClose, isPro, isMultiModel }: Props) {
  const { t } = useTranslation();
  const initialTab: SearchModeTab = current.mode === "none" || current.mode === "basic" ? "basic" : current.mode;
  const [tab, setTab] = useState<SearchModeTab>(initialTab);
  const [complexity, setComplexity] = useState<SearchComplexity>(current.complexity);

  const complexityOptions: { value: SearchComplexity; label: string }[] = [
    { value: 1, label: t("quick") },
    { value: 2, label: t("thorough") },
    { value: 3, label: t("comprehensive") },
  ];

  const modeDescriptions: Record<SearchModeTab, string> = {
    basic: t("search_footer_basic"),
    web: t("search_footer_web"),
    paper: t("search_footer_research"),
  };

  const showComplexity = tab !== "basic";
  const paperDisabled = isMultiModel;
  const needsPro = tab === "web" || tab === "paper";
  const canApply = !paperDisabled || tab !== "paper";
  const costInfo = COST_INFO[tab][showComplexity ? complexity : 1];

  function handleApply() {
    if (needsPro && !isPro) return;
    if (tab === "paper" && paperDisabled) return;
    onSelect({ mode: tab, complexity: showComplexity ? complexity : 1 });
    onClose();
  }

  function handleClear() {
    onSelect({ mode: "none", complexity: 1 });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-surface-1 rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ maxHeight: "85vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Globe size={18} className="text-primary" />
            <h2 className="text-base font-semibold">{t("search_mode")}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-3 text-muted hover:text-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5 overflow-y-auto text-center" style={{ maxHeight: "calc(85vh - 4rem)" }}>
          {/* Mode tabs */}
          <section className="space-y-2">
            <span className="text-sm font-medium">{t("mode")}</span>
            <SegmentedControl
              value={tab}
              options={[
                { value: "basic" as SearchModeTab, label: t("basic") },
                { value: "web" as SearchModeTab, label: t("web_search") },
                { value: "paper" as SearchModeTab, label: t("research") },
              ]}
              onChange={(v) => setTab(v as SearchModeTab)}
            />
          </section>

          {/* Description */}
          <p className="text-xs text-muted leading-relaxed">{modeDescriptions[tab]}</p>

          {/* Paper disabled warning */}
          {tab === "paper" && paperDisabled && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20">
              <AlertCircle size={16} className="text-orange-400 shrink-0 mt-0.5" />
              <p className="text-xs text-orange-300">{t("paper_requires_single_model")}</p>
            </div>
          )}

          {/* Pro gate */}
          {needsPro && !isPro && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-primary/10 border border-primary/20">
              <Zap size={16} className="text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-primary/80">{t("pro_subscription_required")}</p>
            </div>
          )}

          {/* Complexity selector (Web Search / Research Paper only) */}
          {showComplexity && (
            <section className="space-y-2">
              <span className="text-sm font-medium">{t("depth")}</span>
              <SegmentedControl value={complexity} options={complexityOptions} onChange={setComplexity} />
            </section>
          )}

          {/* Cost estimate */}
          <section className="space-y-1.5">
            <span className="text-sm font-medium">{t("estimated_cost")}</span>
            <div className="flex items-center justify-center gap-3 p-3 rounded-xl bg-surface-3/50">
              <div className="flex items-center gap-1">
                {tab === "basic" && <Search size={14} className="text-green-400" />}
                {tab === "web" && <Globe size={14} className="text-blue-400" />}
                {tab === "paper" && <FileText size={14} className="text-orange-400" />}
                <span className="text-sm font-mono font-semibold tracking-wider">{costInfo.tier}</span>
              </div>
              <div className="min-w-0 text-left">
                <p className="text-xs text-foreground">{costInfo.cost} {t("per_message")}</p>
                <p className="text-[11px] text-muted">{t(costInfo.detailKey)}</p>
              </div>
            </div>
          </section>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {current.mode !== "none" && (
              <button onClick={handleClear} className="flex-1 py-2.5 rounded-xl text-sm border border-border/50 text-muted hover:text-foreground hover:bg-surface-3 transition-colors">
                {t("clear_search")}
              </button>
            )}
            <button
              onClick={handleApply}
              disabled={!canApply || (needsPro && !isPro)}
              className="flex-1 py-2.5 rounded-xl text-sm bg-primary text-white font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {t("apply")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
