"use node";

import { writePersistentRuntimeFile } from "../runtime/service_vm";
import { createTool } from "./registry";
import { parseVmEnvironment } from "./vm_shared";

export const vmWriteFile = createTool({
  name: "vm_write_file",
  description: "Write a text file into NanthAI's persistent Vercel runtime workspace.",
  parameters: {
    type: "object",
    properties: {
      environment: { type: "string", description: "Runtime environment: 'python' or 'node'. Defaults to 'python'." },
      path: { type: "string", description: "Destination path." },
      content: { type: "string", description: "Text content to write." },
      overwrite: { type: "boolean", description: "When true, replaces an existing file." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    const filePath = String(args.path ?? "").trim();
    if (!filePath) return { success: false, data: null, error: "Missing path." };
    try {
      const data = await writePersistentRuntimeFile(
        toolCtx,
        parseVmEnvironment(args.environment),
        filePath,
        String(args.content ?? ""),
        args.overwrite === true,
      );
      if (data && typeof data === "object" && "error" in data && data.error) {
        return { success: false, data, error: String(data.error) };
      }
      return { success: true, data };
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
