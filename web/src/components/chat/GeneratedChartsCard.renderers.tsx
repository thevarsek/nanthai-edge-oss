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
  ReferenceLine, Rectangle,
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

// ─── Line chart ───────────────────────────────────────────────────────────────

export function LineChartRenderer({ points, xLabel, yLabel }: {
  points: ChartPoint[]; xLabel?: string; yLabel?: string;
}) {
  const groups = [...new Set(points.map((p) => p.group).filter(Boolean))] as string[];
  const hasGroups = groups.length > 1;

  if (hasGroups) {
    // Pivot: rows keyed by x, columns per group
    const xVals = [...new Set(points.map((p) => p.x))];
    const data = xVals.map((x) => {
      const row: Record<string, unknown> = { x };
      for (const g of groups) row[g] = points.find((p) => p.x === x && p.group === g)?.y ?? null;
      return row;
    });
    return (
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid stroke={GRID_STROKE} />
          <XAxis dataKey="x" tick={AXIS_STYLE} label={xLabel ? { value: xLabel, position: "insideBottom", offset: -4, style: AXIS_STYLE } : undefined} />
          <YAxis tick={AXIS_STYLE} label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", style: AXIS_STYLE } : undefined} />
          <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {groups.map((g, i) => <Line key={g} dataKey={g} stroke={pickColor(i)} dot={false} strokeWidth={2} />)}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
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

export function BarChartRenderer({ bars, xLabel, yLabel }: {
  bars: ChartBar[]; xLabel?: string; yLabel?: string;
}) {
  const groups = [...new Set(bars.map((b) => b.group).filter(Boolean))] as string[];
  const hasGroups = groups.length > 1;

  if (hasGroups) {
    const labels = [...new Set(bars.map((b) => b.label))];
    const data = labels.map((l) => {
      const row: Record<string, unknown> = { label: l };
      for (const g of groups) row[g] = bars.find((b) => b.label === l && b.group === g)?.value ?? 0;
      return row;
    });
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid stroke={GRID_STROKE} />
          <XAxis dataKey="label" tick={AXIS_STYLE} label={xLabel ? { value: xLabel, position: "insideBottom", offset: -4, style: AXIS_STYLE } : undefined} />
          <YAxis tick={AXIS_STYLE} label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", style: AXIS_STYLE } : undefined} />
          <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {groups.map((g, i) => <Bar key={g} dataKey={g} fill={pickColor(i)} radius={[4, 4, 0, 0]} />)}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
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

export function ScatterChartRenderer({ points, xLabel, yLabel }: {
  points: ChartPoint[]; xLabel?: string; yLabel?: string;
}) {
  const groups = [...new Set(points.map((p) => p.group).filter(Boolean))] as string[];
  const hasGroups = groups.length > 1;
  const isNumericX = points.every((p) => typeof p.x === "number");

  if (hasGroups) {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart>
          <CartesianGrid stroke={GRID_STROKE} />
          <XAxis dataKey="x" type={isNumericX ? "number" : "category"} tick={AXIS_STYLE} name={xLabel ?? "x"} />
          <YAxis dataKey="y" tick={AXIS_STYLE} name={yLabel ?? "y"} />
          <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {groups.map((g, i) => (
            <Scatter key={g} name={g} data={points.filter((p) => p.group === g)} fill={pickColor(i)} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
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

export function PieChartRenderer({ slices }: { slices: ChartSlice[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
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
  const { x, y, width, height } = props as { x: number; y: number; width: number; height: number };
  return <Rectangle x={x} y={y} width={width} height={height} fill={pickColor(0)} fillOpacity={0.3} stroke={pickColor(0)} />;
}

export function BoxChartRenderer({ boxes }: { boxes: ChartBox[] }) {
  // Transform for ComposedChart: each box becomes a data row
  const data = boxes.map((b) => ({
    label: b.label, min: b.min, q1: b.q1, median: b.median,
    q3: b.q3, max: b.max, iqr: b.q3 - b.q1, base: b.q1,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data}>
        <CartesianGrid stroke={GRID_STROKE} />
        <XAxis dataKey="label" tick={AXIS_STYLE} />
        <YAxis tick={AXIS_STYLE} />
        <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
        {/* IQR box: stack base (invisible) + iqr range */}
        <Bar dataKey="base" stackId="box" fill="transparent" />
        <Bar dataKey="iqr" stackId="box" shape={<BoxShape />} />
        {/* Median line */}
        {data.map((d, i) => (
          <ReferenceLine key={i} y={d.median} stroke={pickColor(0)} strokeWidth={2} segment={[{ x: d.label, y: d.median }, { x: d.label, y: d.median }]} ifOverflow="extendDomain" />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
