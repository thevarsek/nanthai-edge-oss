"use node";

// convex/runtime/service_analytics_common.ts
// =============================================================================
// Shared chart/output processing logic for data_python_exec (Pyodide) and
// data_python_sandbox (Vercel Sandbox).
//
// Both analytics services have the same post-execution pipeline:
//   1. Store chart PNGs in Convex storage
//   2. Store exported output files (capped)
//   3. Build a text summary from stdout/stderr/charts/files/warnings
//
// This module extracts those three steps into reusable functions.
// =============================================================================

import { ToolExecutionContext } from "../tools/registry";
import { type RuntimeArtifactBlob } from "./service_analytics_charts";
import { RUNTIME_MAX_CHARTS_PER_TOOL_CALL, RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL } from "./shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChartInput {
  pngBytes: Uint8Array;
  index: number;
}

export interface OutputFileInput {
  path: string;
  bytes: Uint8Array;
  mimeType: string;
}

export interface StoredFileEntry {
  storageId?: string;
  path?: string;
  filename?: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl?: string | null;
}

export interface ProcessingDeps {
  storeArtifactBytes: (
    toolCtx: ToolExecutionContext,
    bytes: Uint8Array,
    filename: string,
    mimeType: string,
  ) => Promise<{
    storageId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    downloadUrl: string | null;
  }>;
  buildChartPreviewArtifact: (
    pngBytesOrBase64: Uint8Array | string,
    index: number,
    title?: string,
  ) => RuntimeArtifactBlob;
}

// ---------------------------------------------------------------------------
// processCharts
//
// Store chart PNGs in Convex storage, appending entries to exportedFiles.
// ---------------------------------------------------------------------------

export async function processCharts(
  toolCtx: ToolExecutionContext,
  charts: ChartInput[],
  exportedFiles: StoredFileEntry[],
  warnings: string[],
  deps: ProcessingDeps,
): Promise<void> {
  const chartList = charts.slice(0, RUNTIME_MAX_CHARTS_PER_TOOL_CALL);
  for (let i = 0; i < chartList.length; i++) {
    const { pngBytes, index } = chartList[i];
    try {
      const previewArtifact = deps.buildChartPreviewArtifact(pngBytes, index);
      const stored = await deps.storeArtifactBytes(
        toolCtx,
        pngBytes,
        previewArtifact.filename,
        previewArtifact.mimeType,
      );
      exportedFiles.push({
        storageId: stored.storageId,
        filename: stored.filename,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        downloadUrl: stored.downloadUrl,
      });
    } catch (err) {
      warnings.push(`Failed to store chart ${i}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// processOutputFiles
//
// Store exported output files (capped to remaining budget), appending to
// exportedFiles.
// ---------------------------------------------------------------------------

export async function processOutputFiles(
  toolCtx: ToolExecutionContext,
  outputFiles: OutputFileInput[],
  exportedFiles: StoredFileEntry[],
  warnings: string[],
  deps: ProcessingDeps,
): Promise<void> {
  const outputFilesCapped = outputFiles.slice(
    0,
    RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL - exportedFiles.length,
  );
  for (const outFile of outputFilesCapped) {
    try {
      const stored = await deps.storeArtifactBytes(
        toolCtx,
        outFile.bytes,
        outFile.path.split("/").pop() || "output",
        outFile.mimeType,
      );
      exportedFiles.push({
        storageId: stored.storageId,
        path: outFile.path,
        filename: stored.filename,
        mimeType: outFile.mimeType,
        sizeBytes: outFile.bytes.byteLength,
        downloadUrl: stored.downloadUrl,
      });
    } catch (err) {
      warnings.push(
        `Failed to store export ${outFile.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
      exportedFiles.push({ path: outFile.path, mimeType: outFile.mimeType, sizeBytes: outFile.bytes.byteLength });
    }
  }
  if (outputFiles.length > outputFilesCapped.length) {
    warnings.push(
      `Only ${outputFilesCapped.length} of ${outputFiles.length} output files were stored (limit: ${RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL}).`,
    );
  }
}

// ---------------------------------------------------------------------------
// buildResultSummary
//
// Assemble the text summary from stdout, stderr, charts, exported files,
// and warnings.
// ---------------------------------------------------------------------------

export function buildResultSummary(
  stdout: string[] | string,
  stderr: string[] | string,
  chartCount: number,
  exportedFiles: StoredFileEntry[],
  warnings: string[],
): string[] {
  const summary: string[] = [];

  // stdout — may be string[] (Pyodide) or string (Vercel Sandbox)
  const stdoutText = Array.isArray(stdout) ? stdout.join("\n") : stdout;
  if (stdoutText) summary.push(stdoutText);

  // stderr
  const stderrText = Array.isArray(stderr) ? stderr.join("\n") : stderr;
  if (stderrText) summary.push("stderr:\n" + stderrText);

  if (chartCount > 0) summary.push(`${chartCount} chart(s) generated.`);

  // Filter out chart entries to avoid double-counting them in the "files
  // exported" line (charts are already reported via the "chart(s) generated"
  // line above). This relies on an invariant:
  //   - processCharts() pushes entries with NO `path` field (only `filename`)
  //   - processOutputFiles() pushes entries with a `path` field
  // So `f.mimeType !== "image/png" || f.path` keeps all non-PNG files plus
  // any PNG that came from processOutputFiles (i.e. has a path).
  const nonChartFiles = exportedFiles.filter((f) => f.mimeType !== "image/png" || f.path);
  if (nonChartFiles.length > 0) {
    const fileNames = nonChartFiles
      .map((f) => f.filename || f.path?.split("/").pop() || "file")
      .join(", ");
    summary.push(`${nonChartFiles.length} file(s) exported: ${fileNames}`);
  }

  if (warnings.length > 0) summary.push("Warnings:\n" + warnings.join("\n"));

  return summary;
}
