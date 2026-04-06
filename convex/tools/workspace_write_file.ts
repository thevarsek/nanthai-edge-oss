"use node";

import { createTool } from "./registry";
import { writeWorkspaceFile } from "../runtime/service";

export const workspaceWriteFile = createTool({
  name: "workspace_write_file",
  description:
    "Write a text file into the current chat's code workspace.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Destination path." },
      content: { type: "string", description: "Text content to write." },
      overwrite: { type: "boolean", description: "When true, replaces an existing file." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    const path = String(args.path ?? "").trim();
    if (!path) {
      return { success: false, data: null, error: "Missing path." };
    }

    try {
      const result = await writeWorkspaceFile(
        toolCtx,
        path,
        String(args.content ?? ""),
        args.overwrite === true,
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
