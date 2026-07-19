"use node";

import { createTool } from "./registry";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { PYODIDE_ACTION_TIMEOUT_MS } from "../analytics_workflows/limits";

type DataPythonInputFileArg = {
  storageId?: unknown;
  filename?: unknown;
};

function isDataPythonInputFileArg(value: unknown): value is DataPythonInputFileArg {
  return typeof value === "object" && value !== null;
}

export const dataPythonExec = createTool({
  name: "data_python_exec",
  mayDefer: true,
  description:
    "Run notebook-style Python (Pyodide/WebAssembly) for data analysis and chart generation. " +
    "Pre-loaded packages: numpy, pandas, matplotlib. ~400 MB memory limit, 120s timeout, stateless per call. " +
    "Use for CSV/XLSX analysis, summary statistics, data cleaning, and chart creation with matplotlib. " +
    "To export output files (CSV, JSON, etc.), save them to /tmp/outputs/ — they are auto-captured and " +
    "stored as downloadable artifacts. Charts from plt.show() are captured automatically. " +
    "If this tool fails due to missing packages (scipy, scikit-learn, etc.), memory limits, or timeouts, " +
    "retry the same task using data_python_sandbox which provides a full Linux environment with pip.",
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
        description: "Optional extra file paths to export after execution. Files in /tmp/outputs/ are auto-captured; use this for files written elsewhere.",
        items: { type: "string" },
      },
      captureCharts: {
        type: "boolean",
        description: "Whether to persist chart previews and native chart payloads.",
      },
      timeoutMs: {
        type: "number",
        description: "Optional execution timeout in milliseconds. Defaults to 120000.",
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

    if (!toolCtx.chatId || !toolCtx.messageId || !toolCtx.userMessageId ||
        !toolCtx.jobId || !toolCtx.toolCallId) {
      return { success: false, data: null, error: "Analytics Workflow requires generation context." };
    }
    const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : undefined;
    if (timeoutMs !== undefined && (timeoutMs < 1 || timeoutMs > PYODIDE_ACTION_TIMEOUT_MS)) {
      return {
        success: false,
        data: null,
        error: "Pyodide execution is capped at 120000ms. Split the work into durable rounds or use the bounded sandbox tool.",
      };
    }
    const inputFiles = Array.isArray(args.inputFiles)
      ? args.inputFiles
        .map((item: unknown) => {
          const inputFile = isDataPythonInputFileArg(item) ? item : {};
          return {
            storageId: String(inputFile.storageId ?? "").trim(),
            filename: typeof inputFile.filename === "string" ? inputFile.filename : undefined,
          };
        })
        .filter((item) => item.storageId.length > 0)
      : [];
    const analyticsRunId = await toolCtx.ctx.runMutation(
      internal.analytics_workflows.mutations.prepareRun,
      {
        userId: toolCtx.userId,
        chatId: toolCtx.chatId as Id<"chats">,
        messageId: toolCtx.messageId as Id<"messages">,
        userMessageId: toolCtx.userMessageId as Id<"messages">,
        jobId: toolCtx.jobId as Id<"generationJobs">,
        toolCallId: toolCtx.toolCallId,
        toolName: "data_python_exec",
        code,
        inputFiles,
        exportPaths: Array.isArray(args.exportPaths)
          ? args.exportPaths.map((entry) => String(entry)).filter(Boolean)
          : [],
        captureCharts: typeof args.captureCharts === "boolean" ? args.captureCharts : true,
        packages: [],
        timeoutMs,
      },
    );
    return {
      success: true,
      data: { status: "deferred", analyticsRunId },
      deferred: { kind: "analytics_workflow", data: { analyticsRunId } },
    };
  },
});
