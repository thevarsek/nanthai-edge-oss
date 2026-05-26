export type ChartType = "line" | "bar" | "scatter" | "pie" | "box" | "png_image";

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
function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function parsePoints(elements: any[]): ChartPoint[] {
  return elements.map((e: any) => ({
    x: e.x ?? e.xString ?? e.xNumber ?? "",
    y: numberOrZero(e.y),
    group: e.group,
  }));
}

export function parseBars(elements: any[]): ChartBar[] {
  return elements.map((e: any) => ({
    label: String(e.label ?? ""),
    value: numberOrZero(e.value),
    group: e.group,
  }));
}

export function parseSlices(elements: any[]): ChartSlice[] {
  return elements.map((e: any) => ({
    label: String(e.label ?? ""),
    value: numberOrZero(e.value),
  }));
}

export function parseBoxes(elements: any[]): ChartBox[] {
  return elements.map((e: any) => ({
    label: String(e.label ?? ""),
    min: numberOrZero(e.min),
    q1: numberOrZero(e.q1),
    median: numberOrZero(e.median),
    q3: numberOrZero(e.q3),
    max: numberOrZero(e.max),
    outliers: Array.isArray(e.outliers) ? e.outliers.map(numberOrZero) : undefined,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
