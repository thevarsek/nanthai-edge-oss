"use node";

import { deletePersistentRuntimePath } from "../runtime/service_vm";
import { createTool } from "./registry";
import { parseVmEnvironment } from "./vm_shared";

export const vmDeleteFile = createTool({
  name: "vm_delete_file",
  description: "Delete a file or directory from NanthAI's persistent Vercel runtime workspace.",
  parameters: {
    type: "object",
    properties: {
      environment: { type: "string", description: "Runtime environment: 'python' or 'node'. Defaults to 'python'." },
      path: { type: "string", description: "File or directory path to delete." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    const targetPath = String(args.path ?? "").trim();
    if (!targetPath) return { success: false, data: null, error: "Missing path." };
    try {
      return {
        success: true,
        data: await deletePersistentRuntimePath(
          toolCtx,
          parseVmEnvironment(args.environment),
          targetPath,
        ),
      };
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
