"use node";

// convex/tools/data_python_sandbox.ts
// =============================================================================
// data_python_sandbox: heavy Python execution via Vercel Sandbox.
//
// Use this tool when data_python_exec fails due to missing packages, memory
// limits, or timeouts. Also use it directly for:
//   - scipy, scikit-learn, torch, or any pip package not in numpy/pandas/matplotlib
//   - Large datasets (>50 MB)
//   - Multi-step pipelines that need to persist state within a session
//
// Install packages with: subprocess.run([sys.executable, "-m", "pip", "install", "package"])
//
// Sessions are persisted per chat — packages installed in one call are
// available in subsequent calls within the same chat.
// =============================================================================

import { createTool } from "./registry";
import { runDataPythonSandbox } from "../runtime/service_analytics_sandbox";

export const dataPythonSandbox = createTool({
  name: "data_python_sandbox",
  description:
    "Run Python code in a full Linux sandbox with pip and network access. " +
    "Use when data_python_exec fails due to missing packages, memory limits, or timeouts. " +
    "Also use directly for tasks requiring scipy, scikit-learn, large datasets (>50 MB), " +
    "or any pip package not in numpy/pandas/matplotlib. " +
    "To export output files (CSV, JSON, etc.), save them to /tmp/outputs/ — they are auto-captured and " +
    "stored as downloadable artifacts. Charts from plt.show() are captured automatically. " +
    "State persists across calls within the same chat session — packages installed in one call " +
    "are available in the next, and files on disk survive between messages. " +
    "Install packages with: import subprocess, sys; subprocess.run([sys.executable, \"-m\", \"pip\", \"install\", \"package\", \"-q\"])",
  parameters: {
    type: "object",
    properties: {
      code: { type: "string", description: "Python code to run." },
      inputFiles: {
        type: "array",
        description: "Optional files to import into /tmp/inputs/. Each file will be available at /tmp/inputs/<filename>.",
        items: {
          type: "object",
          properties: {
            storageId: { type: "string" },
            filename: { type: "string" },
          },
          required: ["storageId"],
          additionalProperties: false,
        },
      },
      exportPaths: {
        type: "array",
        description: "Optional extra sandbox paths to export after execution. Files in /tmp/outputs/ are auto-captured; use this for files written elsewhere.",
        items: { type: "string" },
      },
      captureCharts: {
        type: "boolean",
        description: "Whether to capture matplotlib charts as PNG artifacts.",
      },
      packages: {
        type: "array",
        description: "Optional pip packages to install before running code (new sessions only).",
        items: { type: "string" },
      },
      timeoutMs: {
        type: "number",
        description: "Optional execution timeout in milliseconds. Defaults to 300000 (5 min).",
      },
    },
    required: ["code"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    const code = String(args.code ?? "").trim();
    if (!code) {
      return { success: false, data: null, error: "Missing code." };
    }

    const inputFiles = Array.isArray(args.inputFiles)
      ? (args.inputFiles as Array<{ storageId: string; filename?: string }>)
      : undefined;

    const exportPaths = Array.isArray(args.exportPaths)
      ? (args.exportPaths as string[])
      : undefined;

    const packages = Array.isArray(args.packages)
      ? (args.packages as string[])
      : undefined;

    const captureCharts = typeof args.captureCharts === "boolean" ? args.captureCharts : true;
    const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : undefined;

    try {
      // Always return success: true when the service call completes.
      // Script-level errors (non-zero exit code, timeouts, etc.) are already
      // embedded in result.text and result.resultsSummary by the service
      // layer — the model reads them as part of the structured data payload.
      //
      // Previously, a regex scan of resultsSummary for /error|failed/i
      // marked the call as failed, but resultsSummary includes stdout and
      // warnings — any script printing "error rate" or a non-fatal warning
      // like "Session tracking failed" would be misclassified, causing the
      // execute_loop to send only `{ error }` instead of the full data.
      const result = await runDataPythonSandbox(toolCtx, {
        code,
        inputFiles,
        exportPaths,
        captureCharts,
        packages,
        timeoutMs,
      });

      return {
        success: true,
        data: {
          text: result.text,
          resultsSummary: result.resultsSummary,
          importedFiles: result.importedFiles,
          exportedFiles: result.exportedFiles,
          chartsCreated: result.chartsCreated,
          warnings: result.warnings,
        },
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
