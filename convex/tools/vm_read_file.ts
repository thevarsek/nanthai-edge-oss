"use node";

import { readPersistentRuntimeFile } from "../runtime/service_vm";
import { createTool } from "./registry";
import { parseVmEnvironment } from "./vm_shared";

export const vmReadFile = createTool({
  name: "vm_read_file",
  description: "Read a file from NanthAI's persistent Vercel runtime workspace.",
  parameters: {
    type: "object",
    properties: {
      environment: { type: "string", description: "Runtime environment: 'python' or 'node'. Defaults to 'python'." },
      path: { type: "string", description: "Path to the file to read." },
      maxBytes: { type: "number", description: "Optional maximum bytes to read before truncation." },
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
        data: await readPersistentRuntimeFile(
          toolCtx,
          parseVmEnvironment(args.environment),
          filePath,
          typeof args.maxBytes === "number" ? args.maxBytes : undefined,
        ),
      };
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
