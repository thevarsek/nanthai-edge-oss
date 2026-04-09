// components/chat/GeneratedChartsCard.tsx
// Container that fetches generated charts for a message and renders each one.
// Mirrors iOS GeneratedChartCardsContainer + GeneratedChartCardView.

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { BarChart3, X, Maximize2 } from "lucide-react";
import {
  type ChartType,
  parsePoints,
  parseBars,
  parseSlices,
  parseBoxes,
} from "./GeneratedChartsCard.data";
import {
  LineChartRenderer,
  BarChartRenderer,
  ScatterChartRenderer,
  PieChartRenderer,
  BoxChartRenderer,
} from "./GeneratedChartsCard.renderers";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GeneratedChart {
  _id: string;
  chartType: ChartType;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  xUnit?: string;
  yUnit?: string;
  elements: unknown[];
  pngBase64?: string;
}

// ─── Chart type badge ─────────────────────────────────────────────────────────

const TYPE_LABELS: Record<ChartType, string> = {
  line: "Line", bar: "Bar", scatter: "Scatter", pie: "Pie", box: "Box", png_image: "Image",
};

function ChartTypeBadge({ type }: { type: ChartType }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium uppercase tracking-wide">
      {TYPE_LABELS[type]}
    </span>
  );
}

// ─── Subtitle from axis labels + units ────────────────────────────────────────

function chartSubtitle(c: GeneratedChart): string | null {
  const parts: string[] = [];
  if (c.xLabel) parts.push(c.xUnit ? `${c.xLabel} (${c.xUnit})` : c.xLabel);
  if (c.yLabel) parts.push(c.yUnit ? `${c.yLabel} (${c.yUnit})` : c.yLabel);
  return parts.length > 0 ? parts.join(" vs ") : null;
}

// ─── Chart renderer dispatch ──────────────────────────────────────────────────

function ChartRenderer({ chart }: { chart: GeneratedChart }) {
  const { t } = useTranslation();
  const elements = chart.elements ?? [];
  if (elements.length === 0 && chart.chartType !== "png_image") {
    return <p className="text-xs text-muted italic py-4 text-center">{t("no_data")}</p>;
  }

  switch (chart.chartType) {
    case "line":
      return <LineChartRenderer points={parsePoints(elements)} xLabel={chart.xLabel} yLabel={chart.yLabel} />;
    case "bar":
      return <BarChartRenderer bars={parseBars(elements)} xLabel={chart.xLabel} yLabel={chart.yLabel} />;
    case "scatter":
      return <ScatterChartRenderer points={parsePoints(elements)} xLabel={chart.xLabel} yLabel={chart.yLabel} />;
    case "pie":
      return <PieChartRenderer slices={parseSlices(elements)} />;
    case "box":
      return <BoxChartRenderer boxes={parseBoxes(elements)} />;
    case "png_image":
      return chart.pngBase64
        ? <img src={`data:image/png;base64,${chart.pngBase64}`} alt={chart.title ?? "Chart"} className="w-full h-auto rounded" />
        : <p className="text-xs text-muted italic py-4 text-center">{t("no_data")}</p>;
    default:
      return <p className="text-xs text-muted italic py-4 text-center">{t("unsupported_chart_type")}</p>;
  }
}

// ─── Single chart card ────────────────────────────────────────────────────────

function ChartCard({ chart, onExpand }: { chart: GeneratedChart; onExpand: () => void }) {
  const subtitle = useMemo(() => chartSubtitle(chart), [chart]);

  return (
    <div className="rounded-xl border border-border/20 bg-surface-2/50 overflow-hidden mt-2">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/20">
        <BarChart3 size={14} className="text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          {chart.title && (
            <p className="text-xs font-semibold text-foreground truncate">{chart.title}</p>
          )}
          {subtitle && (
            <p className="text-[11px] text-muted truncate">{subtitle}</p>
          )}
        </div>
        <ChartTypeBadge type={chart.chartType} />
        <button
          onClick={onExpand}
          className="p-1 rounded hover:bg-surface-3 text-muted hover:text-foreground transition-colors"
          title="Expand chart"
        >
          <Maximize2 size={13} />
        </button>
      </div>

      {/* Chart body */}
      <div className="px-2 py-3">
        <ChartRenderer chart={chart} />
      </div>
    </div>
  );
}

// ─── Expanded modal ───────────────────────────────────────────────────────────

function ChartExpandedModal({ chart, onClose }: { chart: GeneratedChart; onClose: () => void }) {
  const subtitle = useMemo(() => chartSubtitle(chart), [chart]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-3xl mx-4 rounded-2xl border border-border/20 bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/20">
          <BarChart3 size={16} className="text-primary" />
          <div className="flex-1 min-w-0">
            {chart.title && <p className="text-sm font-semibold text-foreground">{chart.title}</p>}
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
          <ChartTypeBadge type={chart.chartType} />
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-3 text-muted hover:text-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Expanded chart */}
        <div className="p-4" style={{ height: 400 }}>
          <ChartRenderer chart={chart} />
        </div>
      </div>
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export function GeneratedChartsCard({ messageId }: { messageId: Id<"messages"> }) {
  const charts = useQuery(api.chat.queries.getGeneratedChartsByMessage, { messageId });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!charts?.length) return null;

  const expandedChart = expandedId
    ? (charts as GeneratedChart[]).find((c) => c._id === expandedId)
    : undefined;

  return (
    <>
      {(charts as GeneratedChart[]).map((chart) => (
        <ChartCard
          key={chart._id}
          chart={chart}
          onExpand={() => setExpandedId(chart._id)}
        />
      ))}
      {expandedChart && (
        <ChartExpandedModal chart={expandedChart} onClose={() => setExpandedId(null)} />
      )}
    </>
  );
}
