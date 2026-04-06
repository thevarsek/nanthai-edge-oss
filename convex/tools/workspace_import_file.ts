"use node";

import { createTool } from "./registry";
import { importOwnedStorageFileToWorkspace } from "../runtime/storage";

export const workspaceImportFile = createTool({
  name: "workspace_import_file",
  description:
    "Import a user-owned file from NanthAI storage into the current chat workspace.",
  parameters: {
    type: "object",
    properties: {
      storageId: { type: "string", description: "Convex storage ID of the file to import." },
      filename: { type: "string", description: "Optional filename override inside the workspace." },
      targetPath: { type: "string", description: "Optional target path inside the workspace." },
    },
    required: ["storageId"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    const storageId = String(args.storageId ?? "").trim();
    if (!storageId) {
      return { success: false, data: null, error: "Missing storageId." };
    }

    try {
      return {
        success: true,
        data: await importOwnedStorageFileToWorkspace(
          toolCtx,
          storageId,
          typeof args.filename === "string" ? args.filename : undefined,
          typeof args.targetPath === "string" ? args.targetPath : undefined,
        ),
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
