"use node";

import { createTool } from "./registry";
import { makeWorkspaceDirs } from "../runtime/service";

export const workspaceMakeDirs = createTool({
  name: "workspace_make_dirs",
  description:
    "Create a directory and any missing parent directories in the current chat's code workspace.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path to create." },
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
      const result = await makeWorkspaceDirs(toolCtx, path);
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
