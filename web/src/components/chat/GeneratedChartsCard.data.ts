export type ChartType = "line" | "bar" | "scatter" | "pie" | "box";

export interface ChartPoint { x: string | number; y: number; group?: string }
export interface ChartBar { label: string; value: number; group?: string }
export interface ChartSlice { label: string; value: number }
export interface ChartBox {
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers?: number[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parsePoints(elements: any[]): ChartPoint[] {
  return elements.map((e: any) => ({
    x: e.x ?? e.xString ?? e.xNumber ?? "",
    y: typeof e.y === "number" ? e.y : 0,
    group: e.group,
  }));
}

export function parseBars(elements: any[]): ChartBar[] {
  return elements.map((e: any) => ({
    label: String(e.label ?? ""),
    value: typeof e.value === "number" ? e.value : 0,
    group: e.group,
  }));
}

export function parseSlices(elements: any[]): ChartSlice[] {
  return elements.map((e: any) => ({
    label: String(e.label ?? ""),
    value: typeof e.value === "number" ? e.value : 0,
  }));
}

export function parseBoxes(elements: any[]): ChartBox[] {
  return elements.map((e: any) => ({
    label: String(e.label ?? ""),
    min: e.min ?? 0,
    q1: e.q1 ?? 0,
    median: e.median ?? 0,
    q3: e.q3 ?? 0,
    max: e.max ?? 0,
    outliers: e.outliers,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
