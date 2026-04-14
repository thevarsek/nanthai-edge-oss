"use node";

import { makePersistentRuntimeDirs } from "../runtime/service_vm";
import { createTool } from "./registry";
import { parseVmEnvironment } from "./vm_shared";

export const vmMakeDirs = createTool({
  name: "vm_make_dirs",
  description: "Create directories inside NanthAI's persistent Vercel runtime workspace.",
  parameters: {
    type: "object",
    properties: {
      environment: { type: "string", description: "Runtime environment: 'python' or 'node'. Defaults to 'python'." },
      path: { type: "string", description: "Directory path to create." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    const dirPath = String(args.path ?? "").trim();
    if (!dirPath) return { success: false, data: null, error: "Missing path." };
    try {
      return {
        success: true,
        data: await makePersistentRuntimeDirs(
          toolCtx,
          parseVmEnvironment(args.environment),
          dirPath,
        ),
      };
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
