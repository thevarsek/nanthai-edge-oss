"use node";

import { createTool } from "./registry";
import { listWorkspaceFiles } from "../runtime/service";

export const workspaceListFiles = createTool({
  name: "workspace_list_files",
  description:
    "List files and directories inside the current chat's code workspace.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Optional path to list. Defaults to the workspace root." },
      recursive: { type: "boolean", description: "When true, lists files recursively." },
    },
    required: [],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    try {
      const result = await listWorkspaceFiles(
        toolCtx,
        typeof args.path === "string" ? args.path : undefined,
        args.recursive === true,
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
