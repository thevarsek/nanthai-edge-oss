"use node";

import { createTool } from "./registry";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { DATA_PYTHON_EXEC_TIMEOUT_MS } from "../analytics_workflows/limits";
import {
  missingVercelSandboxEnv,
  PYTHON_SANDBOX_UNAVAILABLE_ERROR,
} from "../runtime/vercel_sandbox_config";

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
    "Run notebook-style Python for data analysis and chart generation in an isolated Linux sandbox. " +
    "numpy, pandas and matplotlib are installed automatically when imported. 120s timeout. " +
    "Python variables do not persist between calls; files on disk persist within this chat's sandbox. " +
    "Use for CSV/XLSX analysis, summary statistics, data cleaning, and chart creation with matplotlib. " +
    "To export output files (CSV, JSON, etc.), save them to /tmp/outputs/ — they are auto-captured and " +
    "stored as downloadable artifacts. Charts from plt.show() are captured automatically. " +
    "If the task needs other pip packages, longer runs, or this tool times out, " +
    "use data_python_sandbox instead.",
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
    if (timeoutMs !== undefined && (timeoutMs < 1 || timeoutMs > DATA_PYTHON_EXEC_TIMEOUT_MS)) {
      return {
        success: false,
        data: null,
        error: "data_python_exec is capped at 120000ms. Split the work into durable rounds or use the bounded sandbox tool.",
      };
    }
    // Fail closed: model-supplied code runs only in the isolated sandbox.
    const missingSandboxEnv = missingVercelSandboxEnv();
    if (missingSandboxEnv.length > 0) {
      console.error(`[data_python_exec] sandbox not configured: missing ${missingSandboxEnv.join(", ")}`);
      return { success: false, data: null, error: PYTHON_SANDBOX_UNAVAILABLE_ERROR };
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
