"use node";

// convex/runtime/service_analytics.ts
// =============================================================================
// Python data analytics execution via Pyodide.
//
// data_python_exec: runs Python code with numpy/pandas/matplotlib in a
// stateless Pyodide WASM environment. Each call initializes a fresh Pyodide
// instance — no session tracking, no persistent filesystem.
//
// When Pyodide cannot execute the task (missing packages, OOM, timeout), the
// function returns a structured error with canRetryWithSandbox: true, and the
// error message in the tool result explicitly tells the model to retry with
// data_python_sandbox instead.
// =============================================================================

import { ConvexError } from "convex/values";
import { ToolExecutionContext } from "../tools/registry";
import { runPyodideCode } from "./pyodide_client";
import { storeArtifactBytes } from "./service_artifacts";
import { resolveOwnedStorageFile } from "./storage";
import {
  buildChartPreviewArtifact,
  type NormalizedGeneratedChart,
} from "./service_analytics_charts";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";
import { processCharts, processOutputFiles, buildResultSummary, type StoredFileEntry } from "./service_analytics_common";

// ---------------------------------------------------------------------------
// Dependency injection (for testing)
// ---------------------------------------------------------------------------

const defaultRuntimeAnalyticsDeps = {
  runPyodideCode,
  storeArtifactBytes,
  resolveOwnedStorageFile,
  buildChartPreviewArtifact,
};

export type RuntimeAnalyticsDeps = typeof defaultRuntimeAnalyticsDeps;

export function createRuntimeAnalyticsDepsForTest(
  overrides: DeepPartial<RuntimeAnalyticsDeps> = {},
): RuntimeAnalyticsDeps {
  return mergeTestDeps(defaultRuntimeAnalyticsDeps, overrides);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireChatId(toolCtx: ToolExecutionContext): string {
  if (!toolCtx.chatId) {
    throw new ConvexError({
      code: "INTERNAL_ERROR" as const,
      message: "Workspace tools require chatId in the tool execution context.",
    });
  }
  return toolCtx.chatId;
}

// ---------------------------------------------------------------------------
// runDataPythonExec
// ---------------------------------------------------------------------------

export async function runDataPythonExec(
  toolCtx: ToolExecutionContext,
  args: {
    code: string;
    inputFiles?: Array<{ storageId: string; filename?: string }>;
    exportPaths?: string[];
    captureCharts?: boolean;
    timeoutMs?: number;
  },
  deps: RuntimeAnalyticsDeps = defaultRuntimeAnalyticsDeps,
): Promise<{
  text: string;
  resultsSummary: string[];
  importedFiles: unknown[];
  exportedFiles: StoredFileEntry[];
  chartsCreated: NormalizedGeneratedChart[];
  warnings: string[];
}> {
  requireChatId(toolCtx);

  const warnings: string[] = [];
  const importedFiles: unknown[] = [];
  const exportedFiles: StoredFileEntry[] = [];
  // chartsCreated is intentionally empty. Chart PNGs are stored in
  // exportedFiles and rendered inline via download URL in markdown.
  // The native chart card UI (generatedCharts table) is not populated —
  // it would duplicate the inline image with no additional value since
  // Pyodide charts are PNG-only (no structured data).
  const chartsCreated: NormalizedGeneratedChart[] = [];

  // Import input files from Convex storage into Pyodide FS paths.
  // Use resolveOwnedStorageFile directly — no sandbox needed, just get the blob.
  const inputFilesForPyodide: Array<{ path: string; bytes: Uint8Array }> = [];
  if (args.inputFiles && args.inputFiles.length > 0) {
    for (const inputFile of args.inputFiles) {
      try {
        const { record, blob } = await deps.resolveOwnedStorageFile(toolCtx, inputFile.storageId);
        const finalFilename = inputFile.filename?.trim() || record.filename;
        const inputPath = `/tmp/inputs/${finalFilename}`;
        const arrayBuffer = await blob.arrayBuffer();
        inputFilesForPyodide.push({ path: inputPath, bytes: new Uint8Array(arrayBuffer) });
        importedFiles.push({ path: inputPath, filename: finalFilename, sizeBytes: record.sizeBytes ?? blob.size });
      } catch (err) {
        warnings.push(
          `Failed to import file ${inputFile.storageId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Run Pyodide
  const result = await deps.runPyodideCode(
    args.code,
    inputFilesForPyodide.length > 0 ? inputFilesForPyodide : undefined,
    args.captureCharts ?? true,
    args.timeoutMs,
    args.exportPaths,
  );

  // Log memory usage
  const { memoryRssMiB } = result;
  console.log(
    `[pyodide] memory: baseline=${memoryRssMiB.baseline}MiB ` +
    `afterLoad=${memoryRssMiB.afterLoad}MiB ` +
    `afterPackages=${memoryRssMiB.afterPackages}MiB ` +
    `afterExecution=${memoryRssMiB.afterExecution}MiB`,
  );
  if (memoryRssMiB.afterExecution > 600) {
    warnings.push(
      `Memory usage is high (${memoryRssMiB.afterExecution} MiB RSS). ` +
      `For large datasets, consider using data_python_sandbox instead.`,
    );
  }

  // If execution failed, build error text for the model
  if (result.error) {
    const lines: string[] = [];
    if (result.stdout.length > 0) {
      lines.push("stdout:\n" + result.stdout.join("\n"));
    }
    if (result.stderr.length > 0) {
      lines.push("stderr:\n" + result.stderr.join("\n"));
    }
    lines.push(result.error);

    return {
      text: lines.join("\n\n"),
      resultsSummary: [result.error],
      importedFiles,
      exportedFiles,
      chartsCreated,
      warnings,
    };
  }

  // Process charts — store PNGs in Convex storage (images render inline via
  // download URL in the model's markdown response).
  await processCharts(toolCtx, result.charts, exportedFiles, warnings, deps);

  // Collect any output files Pyodide wrote (via exportPaths and/or auto-capture
  // from /tmp/outputs/). Limit to RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL to
  // avoid runaway storage consumption from auto-captured directories.
  await processOutputFiles(toolCtx, result.outputFiles, exportedFiles, warnings, deps);

  // Build text summary
  const chartCount = result.charts.slice(0, 5).length;
  const summary = buildResultSummary(result.stdout, result.stderr, chartCount, exportedFiles, warnings);

  return {
    text: summary.join("\n\n") || "Code executed successfully (no output).",
    resultsSummary: summary,
    importedFiles,
    exportedFiles,
    chartsCreated,
    warnings,
  };
}
