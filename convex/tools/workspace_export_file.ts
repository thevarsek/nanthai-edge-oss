"use node";

import { createTool } from "./registry";
import { exportWorkspaceFile } from "../runtime/service_artifacts";

export const workspaceExportFile = createTool({
  name: "workspace_export_file",
  description:
    "Export a file from the current chat's code workspace into NanthAI durable storage.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file inside the workspace." },
      filename: { type: "string", description: "Optional exported filename override." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    const path = String(args.path ?? "").trim();
    if (!path) {
      return { success: false, data: null, error: "Missing path." };
    }

    try {
      const result = await exportWorkspaceFile(
        toolCtx,
        path,
        typeof args.filename === "string" ? args.filename : undefined,
      );
      return { success: true, data: result };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});
