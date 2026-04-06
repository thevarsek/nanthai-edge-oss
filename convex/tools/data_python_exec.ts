"use node";

import { createTool } from "./registry";
import { runDataPythonExec } from "../runtime/service_analytics";

export const dataPythonExec = createTool({
  name: "data_python_exec",
  description:
    "Run notebook-style Python in the current chat workspace for data analysis and chart generation.",
  parameters: {
    type: "object",
    properties: {
      code: { type: "string", description: "Python code to run." },
      inputFiles: {
        type: "array",
        description: "Optional files to import into the workspace inputs directory.",
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
        description: "Optional workspace paths to export after execution.",
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

    try {
      return {
        success: true,
        data: await runDataPythonExec(toolCtx, {
          code,
          inputFiles: Array.isArray(args.inputFiles)
            ? args.inputFiles
              .map((item) => ({
                storageId: String((item as any)?.storageId ?? "").trim(),
                filename: typeof (item as any)?.filename === "string"
                  ? (item as any).filename
                  : undefined,
              }))
              .filter((item) => item.storageId.length > 0)
            : undefined,
          exportPaths: Array.isArray(args.exportPaths)
            ? args.exportPaths.map((entry) => String(entry)).filter(Boolean)
            : undefined,
          captureCharts: typeof args.captureCharts === "boolean" ? args.captureCharts : undefined,
          timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
        }),
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
