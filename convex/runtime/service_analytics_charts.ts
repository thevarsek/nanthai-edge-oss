"use node";

// convex/runtime/service_analytics_charts.ts
// =============================================================================
// Chart helpers for the Pyodide analytics pipeline.
//
// Pyodide outputs raw PNG bytes from matplotlib's Agg backend — there is no
// structured chart JSON, only PNG images.
//
// This module provides:
//   - buildChartPreviewArtifact: wrap PNG bytes in a RuntimeArtifactBlob for storage
//   - buildChartFromPngBytes: create a NormalizedGeneratedChart from PNG bytes
//   - buildChartDataArtifact: serialize NormalizedGeneratedChart elements to CSV
//
// NOTE: buildChartFromPngBytes creates a "png_image" chart type — a pass-through
// type for charts where we only have the image (no structured data to parse).
// The iOS/Android chart renderer handles this type by displaying the PNG preview.
// =============================================================================

import { Buffer } from "node:buffer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NormalizedGeneratedChart {
  toolName: string;
  chartType: "line" | "bar" | "scatter" | "pie" | "box" | "png_image";
  title?: string;
  xLabel?: string;
  yLabel?: string;
  xUnit?: string;
  yUnit?: string;
  elements: unknown[];
  /** For png_image charts: base64-encoded PNG for inline preview */
  pngBase64?: string;
}

export interface RuntimeArtifactBlob {
  filename: string;
  mimeType: string;
  blob: Blob;
}

// ---------------------------------------------------------------------------
// buildChartPreviewArtifact
//
// Wraps raw PNG bytes in a RuntimeArtifactBlob ready for Convex storage.
// Accepts Uint8Array (from Pyodide FS) or a base64 string.
// ---------------------------------------------------------------------------

export function buildChartPreviewArtifact(
  pngBytesOrBase64: Uint8Array | string,
  index: number,
  title?: string,
): RuntimeArtifactBlob {
  const filename = `${sanitizeStem(title, `chart-${index}`)}.png`;
  const bytes =
    typeof pngBytesOrBase64 === "string"
      ? Buffer.from(pngBytesOrBase64, "base64")
      : Buffer.from(pngBytesOrBase64);
  return {
    filename,
    mimeType: "image/png",
    blob: new Blob([bytes], { type: "image/png" }),
  };
}

// ---------------------------------------------------------------------------
// buildChartFromPngBytes
//
// Creates a NormalizedGeneratedChart from raw PNG bytes.
// chartType is "png_image" — a pass-through for image-only charts.
// ---------------------------------------------------------------------------

export function buildChartFromPngBytes(
  pngBytes: Uint8Array,
  index: number,
  filename?: string,
  toolName = "data_python_exec",
): NormalizedGeneratedChart | null {
  if (!pngBytes || pngBytes.length === 0) return null;
  const pngBase64 = Buffer.from(pngBytes).toString("base64");
  const title = filename ? filename.replace(/\.png$/i, "").replace(/-/g, " ") : `Chart ${index + 1}`;
  return {
    toolName,
    chartType: "png_image",
    title,
    elements: [],
    pngBase64,
  };
}

// ---------------------------------------------------------------------------
// buildChartDataArtifact
//
// Serializes NormalizedGeneratedChart elements to CSV.
// For "png_image" charts, no CSV is produced (no structured data).
// ---------------------------------------------------------------------------

export function buildChartDataArtifact(
  chart: NormalizedGeneratedChart,
  index: number,
): RuntimeArtifactBlob | null {
  // PNG-only charts have no structured data to export
  if (chart.chartType === "png_image") return null;

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

// ---------------------------------------------------------------------------
// escapeCsv
// ---------------------------------------------------------------------------

function escapeCsv(value: string): string {
  if (/[,"\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

// ---------------------------------------------------------------------------
// toFiniteNumber (re-exported for tests)
// ---------------------------------------------------------------------------

export { toFiniteNumber };
