// components/chat/GeneratedChartsCard.renderers.tsx
// Individual Recharts renderers for each chart type (line, bar, scatter, pie, box).
// Extracted from GeneratedChartsCard for the 300-line rule.

import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  ScatterChart, Scatter,
  PieChart, Pie, Cell,
  ComposedChart, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
  Rectangle,
} from "recharts";
import type { ChartBar, ChartBox, ChartPoint, ChartSlice } from "./GeneratedChartsCard.data";

// ─── Shared palette ──────────────────────────────────────────────────────────

const COLORS = [
  "#60a5fa", "#f59e0b", "#34d399", "#f472b6", "#a78bfa",
  "#fb923c", "#22d3ee", "#e879f9", "#4ade80", "#f87171",
];

function pickColor(i: number): string {
  return COLORS[i % COLORS.length]!;
}

const AXIS_STYLE = { fontSize: 11, fill: "var(--nanth-muted)" } as const;
const GRID_STROKE = "rgba(255,255,255,0.06)";
const UNGROUPED_SERIES_LABEL = "Ungrouped";
export type ChartHeight = number | `${number}%`;

function chartGroupName(group: string | undefined): string {
  return group?.trim() || UNGROUPED_SERIES_LABEL;
}

function seriesKey(index: number): string {
  return `series_${index}`;
}

function occurrenceKey(value: string | number, group: string, seen: Map<string, number>): string {
  const key = `${String(value)}\u0000${group}`;
  const occurrence = seen.get(key) ?? 0;
  seen.set(key, occurrence + 1);
  return `${String(value)}\u0000${occurrence}`;
}

// ─── Line chart ───────────────────────────────────────────────────────────────

export function LineChartRenderer({ points, xLabel, yLabel, height = 220 }: {
  points: ChartPoint[]; xLabel?: string; yLabel?: string; height?: ChartHeight;
}) {
  const groups = [...new Set(points.map((p) => chartGroupName(p.group)))];
  const hasGroups = groups.length > 1;

  if (hasGroups) {
    const seen = new Map<string, number>();
    const rows = new Map<string, Record<string, unknown>>();
    points.forEach((point) => {
      const group = chartGroupName(point.group);
      const key = occurrenceKey(point.x, group, seen);
      const row = rows.get(key) ?? { x: point.x };
      row[seriesKey(groups.indexOf(group))] = point.y;
      rows.set(key, row);
    });
    const data = [...rows.values()];
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid stroke={GRID_STROKE} />
          <XAxis dataKey="x" tick={AXIS_STYLE} label={xLabel ? { value: xLabel, position: "insideBottom", offset: -4, style: AXIS_STYLE } : undefined} />
          <YAxis tick={AXIS_STYLE} label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", style: AXIS_STYLE } : undefined} />
          <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {groups.map((g, i) => <Line key={g} name={g} dataKey={seriesKey(i)} stroke={pickColor(i)} dot={false} strokeWidth={2} />)}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points}>
        <CartesianGrid stroke={GRID_STROKE} />
        <XAxis dataKey="x" tick={AXIS_STYLE} label={xLabel ? { value: xLabel, position: "insideBottom", offset: -4, style: AXIS_STYLE } : undefined} />
        <YAxis tick={AXIS_STYLE} label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", style: AXIS_STYLE } : undefined} />
        <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
        <Line dataKey="y" stroke={pickColor(0)} dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Bar chart ────────────────────────────────────────────────────────────────

export function BarChartRenderer({ bars, xLabel, yLabel, height = 220 }: {
  bars: ChartBar[]; xLabel?: string; yLabel?: string; height?: ChartHeight;
}) {
  const groups = [...new Set(bars.map((b) => chartGroupName(b.group)))];
  const hasGroups = groups.length > 1;

  if (hasGroups) {
    const seen = new Map<string, number>();
    const rows = new Map<string, Record<string, unknown>>();
    bars.forEach((bar) => {
      const group = chartGroupName(bar.group);
      const key = occurrenceKey(bar.label, group, seen);
      const row = rows.get(key) ?? { label: bar.label };
      row[seriesKey(groups.indexOf(group))] = bar.value;
      rows.set(key, row);
    });
    const data = [...rows.values()];
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data}>
          <CartesianGrid stroke={GRID_STROKE} />
          <XAxis dataKey="label" tick={AXIS_STYLE} label={xLabel ? { value: xLabel, position: "insideBottom", offset: -4, style: AXIS_STYLE } : undefined} />
          <YAxis tick={AXIS_STYLE} label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", style: AXIS_STYLE } : undefined} />
          <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {groups.map((g, i) => <Bar key={g} name={g} dataKey={seriesKey(i)} fill={pickColor(i)} radius={[4, 4, 0, 0]} />)}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={bars}>
        <CartesianGrid stroke={GRID_STROKE} />
        <XAxis dataKey="label" tick={AXIS_STYLE} label={xLabel ? { value: xLabel, position: "insideBottom", offset: -4, style: AXIS_STYLE } : undefined} />
        <YAxis tick={AXIS_STYLE} label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", style: AXIS_STYLE } : undefined} />
        <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
        <Bar dataKey="value" fill={pickColor(0)} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Scatter chart ────────────────────────────────────────────────────────────

export function ScatterChartRenderer({ points, xLabel, yLabel, height = 220 }: {
  points: ChartPoint[]; xLabel?: string; yLabel?: string; height?: ChartHeight;
}) {
  const groups = [...new Set(points.map((p) => chartGroupName(p.group)))];
  const hasGroups = groups.length > 1;
  const isNumericX = points.every((p) => typeof p.x === "number");

  if (hasGroups) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart>
          <CartesianGrid stroke={GRID_STROKE} />
          <XAxis dataKey="x" type={isNumericX ? "number" : "category"} tick={AXIS_STYLE} name={xLabel ?? "x"} />
          <YAxis dataKey="y" tick={AXIS_STYLE} name={yLabel ?? "y"} />
          <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {groups.map((g, i) => (
            <Scatter key={g} name={g} data={points.filter((p) => chartGroupName(p.group) === g)} fill={pickColor(i)} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart>
        <CartesianGrid stroke={GRID_STROKE} />
        <XAxis dataKey="x" type={isNumericX ? "number" : "category"} tick={AXIS_STYLE} name={xLabel ?? "x"} />
        <YAxis dataKey="y" tick={AXIS_STYLE} name={yLabel ?? "y"} />
        <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
        <Scatter data={points} fill={pickColor(0)} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ─── Pie chart ────────────────────────────────────────────────────────────────

export function PieChartRenderer({ slices, height = 220 }: { slices: ChartSlice[]; height?: ChartHeight }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={slices} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
          {slices.map((_, i) => <Cell key={i} fill={pickColor(i)} />)}
        </Pie>
        <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ─── Box plot (via ComposedChart) ─────────────────────────────────────────────

// Custom shape for the IQR box
function BoxShape(props: Record<string, unknown>) {
  const { x, y, width, height, payload } = props as {
    x: number;
    y: number;
    width: number;
    height: number;
    payload?: { q1: number; median: number; q3: number };
  };
  const medianRatio = payload && payload.q3 !== payload.q1
    ? (payload.q3 - payload.median) / (payload.q3 - payload.q1)
    : 0.5;
  const medianY = y + height * medianRatio;
  return (
    <g>
      <Rectangle x={x} y={y} width={width} height={height} fill={pickColor(0)} fillOpacity={0.3} stroke={pickColor(0)} />
      <line x1={x} x2={x + width} y1={medianY} y2={medianY} stroke={pickColor(0)} strokeWidth={2} />
    </g>
  );
}

function WhiskerShape(props: Record<string, unknown>) {
  const { x, y, width, height } = props as { x: number; y: number; width: number; height: number };
  const centerX = x + width / 2;
  const cap = Math.max(10, width * 0.45);
  return (
    <g>
      <line x1={centerX} x2={centerX} y1={y} y2={y + height} stroke={pickColor(0)} strokeWidth={1.5} />
      <line x1={centerX - cap / 2} x2={centerX + cap / 2} y1={y} y2={y} stroke={pickColor(0)} strokeWidth={1.5} />
      <line x1={centerX - cap / 2} x2={centerX + cap / 2} y1={y + height} y2={y + height} stroke={pickColor(0)} strokeWidth={1.5} />
    </g>
  );
}

export function BoxChartRenderer({ boxes, height = 220 }: { boxes: ChartBox[]; height?: ChartHeight }) {
  // Transform for ComposedChart: each box becomes a data row
  const data = boxes.map((b) => ({
    label: b.label, min: b.min, q1: b.q1, median: b.median,
    q3: b.q3, max: b.max, iqr: b.q3 - b.q1, base: b.q1, range: b.max - b.min,
  }));
  const outliers = boxes.flatMap((box) => (box.outliers ?? []).map((value) => ({
    label: box.label,
    y: value,
  })));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data}>
        <CartesianGrid stroke={GRID_STROKE} />
        <XAxis dataKey="label" tick={AXIS_STYLE} />
        <YAxis tick={AXIS_STYLE} />
        <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
        {/* Min/max whisker: stack min (invisible) + full range. */}
        <Bar dataKey="min" stackId="whisker" fill="transparent" barSize={28} />
        <Bar dataKey="range" stackId="whisker" shape={<WhiskerShape />} barSize={28} />
        {/* IQR box: stack base (invisible) + iqr range. */}
        <Bar dataKey="base" stackId="box" fill="transparent" />
        <Bar dataKey="iqr" stackId="box" shape={<BoxShape />} />
        {outliers.length > 0 && <Scatter data={outliers} dataKey="y" fill={pickColor(0)} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
