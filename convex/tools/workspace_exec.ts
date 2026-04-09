"use node";

import { createTool } from "./registry";
import { runWorkspaceCommand } from "../runtime/service";

export const workspaceExec = createTool({
  name: "workspace_exec",
  description:
    "Run a shell command in this chat's temporary workspace (simulated shell via just-bash). " +
    "Available: coreutils, text processing (grep/sed/awk/jq), python3 (stdlib only), node/ts-node. " +
    "No network access, no pip/npm install, no apt-get — packages beyond stdlib are not available. " +
    "Filesystem persists within this response only; files are lost between messages. " +
    "Use this for scripting, file transformations, and code execution with standard tools. " +
    "For data analysis with numpy/pandas/matplotlib, use data_python_exec instead.",
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
