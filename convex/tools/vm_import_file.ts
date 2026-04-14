"use node";

import { importOwnedStorageFileToPersistentRuntime } from "../runtime/service_vm";
import { createTool } from "./registry";
import { parseVmEnvironment } from "./vm_shared";

export const vmImportFile = createTool({
  name: "vm_import_file",
  description: "Import a user-owned file from NanthAI storage into the persistent Vercel runtime workspace.",
  parameters: {
    type: "object",
    properties: {
      environment: { type: "string", description: "Runtime environment: 'python' or 'node'. Defaults to 'python'." },
      storageId: { type: "string", description: "Convex storage ID of the file to import." },
      filename: { type: "string", description: "Optional filename override inside the runtime workspace." },
      targetPath: { type: "string", description: "Optional absolute or workspace-relative destination path." },
    },
    required: ["storageId"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    const storageId = String(args.storageId ?? "").trim();
    if (!storageId) return { success: false, data: null, error: "Missing storageId." };
    try {
      return {
        success: true,
        data: await importOwnedStorageFileToPersistentRuntime(
          toolCtx,
          parseVmEnvironment(args.environment),
          storageId,
          typeof args.filename === "string" ? args.filename : undefined,
          typeof args.targetPath === "string" ? args.targetPath : undefined,
        ),
      };
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
