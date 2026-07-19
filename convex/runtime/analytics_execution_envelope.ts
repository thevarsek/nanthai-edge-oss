import type { ChartInput, OutputFileInput } from "./service_analytics_common";
import {
  ANALYTICS_ARTIFACT_MAX_BYTES,
  ANALYTICS_ARTIFACT_TOTAL_MAX_BYTES,
  ANALYTICS_ERROR_MAX_CHARS,
  ANALYTICS_IMPORTED_FILE_MAX_CHARS,
  ANALYTICS_IMPORTED_FILE_MAX_COUNT,
  ANALYTICS_STDERR_MAX_CHARS,
  ANALYTICS_STDOUT_MAX_CHARS,
  ANALYTICS_WARNING_MAX_CHARS,
  ANALYTICS_WARNING_MAX_COUNT,
} from "../analytics_workflows/limits";
import {
  RUNTIME_MAX_CHARTS_PER_TOOL_CALL,
  RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL,
} from "./shared";

export interface AnalyticsExecutionEnvelope {
  stdout: string[] | string;
  stderr: string[] | string;
  error: string | null;
  importedFiles: unknown[];
  warnings: string[];
  charts: ChartInput[];
  outputFiles: OutputFileInput[];
}

type SerializedEnvelope = Omit<AnalyticsExecutionEnvelope, "charts" | "outputFiles"> & {
  charts: Array<{ index: number; pngBase64: string }>;
  outputFiles: Array<{ path: string; mimeType: string; bytesBase64: string }>;
};

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

function boundedText(value: string[] | string, limit: number): string {
  const text = Array.isArray(value) ? value.join("\n") : value;
  return text.length > limit ? `${text.slice(0, limit)}\n[truncated]` : text;
}

function boundedImportedFile(value: unknown): unknown {
  const raw = JSON.stringify(value);
  if (raw === undefined) return String(value).slice(0, ANALYTICS_IMPORTED_FILE_MAX_CHARS);
  if (raw.length <= ANALYTICS_IMPORTED_FILE_MAX_CHARS) return value;
  return { summary: raw.slice(0, ANALYTICS_IMPORTED_FILE_MAX_CHARS), truncated: true };
}

export function boundAnalyticsEnvelope(
  envelope: AnalyticsExecutionEnvelope,
): AnalyticsExecutionEnvelope {
  let warnings = envelope.warnings
    .slice(0, ANALYTICS_WARNING_MAX_COUNT)
    .map((warning) => warning.slice(0, ANALYTICS_WARNING_MAX_CHARS));
  let remainingBytes = ANALYTICS_ARTIFACT_TOTAL_MAX_BYTES;
  let remainingArtifacts = RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL;
  const acceptBytes = <T extends { bytes: Uint8Array }>(item: T): boolean => {
    if (remainingArtifacts <= 0) return false;
    if (item.bytes.byteLength > ANALYTICS_ARTIFACT_MAX_BYTES) return false;
    if (item.bytes.byteLength > remainingBytes) return false;
    remainingBytes -= item.bytes.byteLength;
    remainingArtifacts -= 1;
    return true;
  };
  const charts: ChartInput[] = [];
  for (const chart of envelope.charts.slice(0, RUNTIME_MAX_CHARTS_PER_TOOL_CALL)) {
    if (acceptBytes({ bytes: chart.pngBytes })) charts.push(chart);
  }
  const outputFiles = envelope.outputFiles.filter(acceptBytes);
  const omitted = envelope.charts.length - charts.length
    + envelope.outputFiles.length - outputFiles.length;
  if (omitted > 0) {
    warnings = warnings.slice(0, ANALYTICS_WARNING_MAX_COUNT - 1);
    warnings.push(`${omitted} artifact(s) omitted by durable analytics size limits.`);
  }
  return {
    stdout: boundedText(envelope.stdout, ANALYTICS_STDOUT_MAX_CHARS),
    stderr: boundedText(envelope.stderr, ANALYTICS_STDERR_MAX_CHARS),
    error: envelope.error?.slice(0, ANALYTICS_ERROR_MAX_CHARS) ?? null,
    importedFiles: envelope.importedFiles
      .slice(0, ANALYTICS_IMPORTED_FILE_MAX_COUNT)
      .map(boundedImportedFile),
    warnings,
    charts,
    outputFiles,
  };
}

export function serializeAnalyticsEnvelope(envelope: AnalyticsExecutionEnvelope): string {
  const bounded = boundAnalyticsEnvelope(envelope);
  const serialized: SerializedEnvelope = {
    ...bounded,
    charts: bounded.charts.map((chart) => ({
      index: chart.index,
      pngBase64: toBase64(chart.pngBytes),
    })),
    outputFiles: bounded.outputFiles.map((file) => ({
      path: file.path,
      mimeType: file.mimeType,
      bytesBase64: toBase64(file.bytes),
    })),
  };
  return JSON.stringify(serialized);
}

export function deserializeAnalyticsEnvelope(raw: string): AnalyticsExecutionEnvelope {
  const parsed = JSON.parse(raw) as SerializedEnvelope;
  return boundAnalyticsEnvelope({
    ...parsed,
    charts: parsed.charts.map((chart) => ({
      index: chart.index,
      pngBytes: new Uint8Array(Buffer.from(chart.pngBase64, "base64")),
    })),
    outputFiles: parsed.outputFiles.map((file) => ({
      path: file.path,
      mimeType: file.mimeType,
      bytes: new Uint8Array(Buffer.from(file.bytesBase64, "base64")),
    })),
  });
}
