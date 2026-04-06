"use node";

import { Buffer } from "node:buffer";

function sanitizeStem(value: string | undefined, fallback: string): string {
  const stem = value?.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return stem && stem.length > 0 ? stem : fallback;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export interface NormalizedGeneratedChart {
  toolName: string;
  chartType: "line" | "bar" | "scatter" | "pie" | "box";
  title?: string;
  xLabel?: string;
  yLabel?: string;
  xUnit?: string;
  yUnit?: string;
  elements: unknown[];
}

export interface RuntimeArtifactBlob {
  filename: string;
  mimeType: string;
  blob: Blob;
}

export function normalizeE2BChart(
  chart: any,
  toolName = "data_python_exec",
): NormalizedGeneratedChart | null {
  if (!chart || typeof chart !== "object" || typeof chart.type !== "string") {
    return null;
  }

  if (chart.type === "line" || chart.type === "scatter") {
    const elements = (Array.isArray(chart.elements) ? chart.elements : []).flatMap((series: any) => {
      if (!series || !Array.isArray(series.points)) return [];
      return series.points.map((point: [string | number, string | number]) => ({
        x: point[0],
        y: toFiniteNumber(point[1]) ?? 0,
        group: typeof series.label === "string" && series.label.length > 0 ? series.label : undefined,
      }));
    });
    return {
      toolName,
      chartType: chart.type,
      title: chart.title,
      xLabel: chart.x_label,
      yLabel: chart.y_label,
      xUnit: chart.x_unit,
      yUnit: chart.y_unit,
      elements,
    };
  }

  if (chart.type === "bar") {
    return {
      toolName,
      chartType: "bar",
      title: chart.title,
      xLabel: chart.x_label,
      yLabel: chart.y_label,
      xUnit: chart.x_unit,
      yUnit: chart.y_unit,
      elements: (Array.isArray(chart.elements) ? chart.elements : []).map((item: any) => ({
        label: String(item?.label ?? ""),
        value: toFiniteNumber(item?.value) ?? 0,
        group: typeof item?.group === "string" && item.group.length > 0 ? item.group : undefined,
      })),
    };
  }

  if (chart.type === "pie") {
    return {
      toolName,
      chartType: "pie",
      title: chart.title,
      elements: (Array.isArray(chart.elements) ? chart.elements : []).map((item: any) => ({
        label: String(item?.label ?? ""),
        value: toFiniteNumber(item?.angle) ?? 0,
      })),
    };
  }

  if (chart.type === "box_and_whisker") {
    return {
      toolName,
      chartType: "box",
      title: chart.title,
      xLabel: chart.x_label,
      yLabel: chart.y_label,
      xUnit: chart.x_unit,
      yUnit: chart.y_unit,
      elements: (Array.isArray(chart.elements) ? chart.elements : []).map((item: any) => ({
        label: String(item?.label ?? ""),
        min: toFiniteNumber(item?.min) ?? 0,
        q1: toFiniteNumber(item?.first_quartile) ?? 0,
        median: toFiniteNumber(item?.median) ?? 0,
        q3: toFiniteNumber(item?.third_quartile) ?? 0,
        max: toFiniteNumber(item?.max) ?? 0,
        outliers: Array.isArray(item?.outliers)
          ? item.outliers.map((outlier: unknown) => toFiniteNumber(outlier) ?? 0)
          : [],
      })),
    };
  }

  return null;
}

export function buildChartPreviewArtifact(
  pngBase64: string,
  index: number,
  title?: string,
): RuntimeArtifactBlob {
  const filename = `${sanitizeStem(title, `chart-${index}`)}.png`;
  const bytes = Buffer.from(pngBase64, "base64");
  return {
    filename,
    mimeType: "image/png",
    blob: new Blob([bytes], { type: "image/png" }),
  };
}

export function buildChartDataArtifact(
  chart: NormalizedGeneratedChart,
  index: number,
): RuntimeArtifactBlob | null {
  const stem = sanitizeStem(chart.title, `chart-${index}-data`);
  let headers: string[] = [];
  let rows: string[][] = [];

  if (chart.chartType === "line" || chart.chartType === "scatter") {
    headers = ["x", "y", "group"];
    rows = (chart.elements as Array<{ x: string | number; y: number; group?: string }>).map((item) => [
      String(item.x),
      String(item.y),
      item.group ?? "",
    ]);
  } else if (chart.chartType === "bar") {
    headers = ["label", "value", "group"];
    rows = (chart.elements as Array<{ label: string; value: number; group?: string }>).map((item) => [
      item.label,
      String(item.value),
      item.group ?? "",
    ]);
  } else if (chart.chartType === "pie") {
    headers = ["label", "value"];
    rows = (chart.elements as Array<{ label: string; value: number }>).map((item) => [
      item.label,
      String(item.value),
    ]);
  } else if (chart.chartType === "box") {
    headers = ["label", "min", "q1", "median", "q3", "max", "outliers"];
    rows = (chart.elements as Array<{
      label: string;
      min: number;
      q1: number;
      median: number;
      q3: number;
      max: number;
      outliers?: number[];
    }>).map((item) => [
      item.label,
      String(item.min),
      String(item.q1),
      String(item.median),
      String(item.q3),
      String(item.max),
      JSON.stringify(item.outliers ?? []),
    ]);
  } else {
    return null;
  }

  const csv = [headers.join(","), ...rows.map((row) => row.map(escapeCsv).join(","))].join("\n");
  return {
    filename: `${stem}.csv`,
    mimeType: "text/csv",
    blob: new Blob([csv], { type: "text/csv" }),
  };
}

function escapeCsv(value: string): string {
  if (/[,"\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}
