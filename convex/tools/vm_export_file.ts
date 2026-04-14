"use node";

import { exportPersistentRuntimeFile } from "../runtime/service_vm";
import { createTool } from "./registry";
import { parseVmEnvironment } from "./vm_shared";

export const vmExportFile = createTool({
  name: "vm_export_file",
  description: "Export a file from the persistent Vercel runtime workspace into NanthAI durable storage.",
  parameters: {
    type: "object",
    properties: {
      environment: { type: "string", description: "Runtime environment: 'python' or 'node'. Defaults to 'python'." },
      path: { type: "string", description: "Path to the file inside the persistent runtime workspace." },
      filename: { type: "string", description: "Optional exported filename override." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    const filePath = String(args.path ?? "").trim();
    if (!filePath) return { success: false, data: null, error: "Missing path." };
    try {
      return {
        success: true,
        data: await exportPersistentRuntimeFile(
          toolCtx,
          parseVmEnvironment(args.environment),
          filePath,
          typeof args.filename === "string" ? args.filename : undefined,
        ),
      };
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
