"use node";

import { createTool } from "./registry";
import { runWorkspaceCommand } from "../runtime/service";

export const workspaceExec = createTool({
  name: "workspace_exec",
  description:
    "Run a shell command inside the current chat's temporary code workspace. " +
    "Use this for code execution, package installation, compilation, and file processing.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to run in the workspace." },
      cwd: { type: "string", description: "Optional working directory. Defaults to the chat workspace root." },
      timeoutMs: { type: "number", description: "Optional timeout in milliseconds. Defaults to 60000." },
    },
    required: ["command"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    const command = String(args.command ?? "").trim();
    if (!command) {
      return { success: false, data: null, error: "Missing command." };
    }

    try {
      const result = await runWorkspaceCommand(
        toolCtx,
        command,
        typeof args.cwd === "string" ? args.cwd : undefined,
        typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
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
