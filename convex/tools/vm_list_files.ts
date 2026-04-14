"use node";

import { listPersistentRuntimeFiles } from "../runtime/service_vm";
import { createTool } from "./registry";
import { parseVmEnvironment } from "./vm_shared";

export const vmListFiles = createTool({
  name: "vm_list_files",
  description: "List files and directories inside NanthAI's persistent Vercel runtime workspace.",
  parameters: {
    type: "object",
    properties: {
      environment: { type: "string", description: "Runtime environment: 'python' or 'node'. Defaults to 'python'." },
      path: { type: "string", description: "Optional path to list. Defaults to the runtime workspace root." },
      recursive: { type: "boolean", description: "When true, list files recursively." },
    },
    required: [],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    try {
      return {
        success: true,
        data: await listPersistentRuntimeFiles(
          toolCtx,
          parseVmEnvironment(args.environment),
          typeof args.path === "string" ? args.path : undefined,
          args.recursive === true,
        ),
      };
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
