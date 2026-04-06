"use node";

import { createTool } from "./registry";
import { readWorkspaceFile } from "../runtime/service";

export const workspaceReadFile = createTool({
  name: "workspace_read_file",
  description:
    "Read a text file from the current chat's code workspace.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to read." },
      maxBytes: { type: "number", description: "Optional max bytes to read before truncation." },
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
      const result = await readWorkspaceFile(
        toolCtx,
        path,
        typeof args.maxBytes === "number" ? args.maxBytes : undefined,
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
