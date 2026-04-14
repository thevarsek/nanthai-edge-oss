"use node";

import { execPersistentRuntimeCommand } from "../runtime/service_vm";
import { createTool } from "./registry";
import { parseVmEnvironment } from "./vm_shared";

export const vmExec = createTool({
  name: "vm_exec",
  description:
    "Run a shell command in NanthAI's persistent Vercel runtime. " +
    "Use this when work must persist across generations, needs network or package installs, " +
    "or benefits from a long-lived Python or Node environment.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to run." },
      environment: { type: "string", description: "Runtime environment: 'python' or 'node'. Defaults to 'python'." },
      cwd: { type: "string", description: "Optional working directory. Defaults to the persistent workspace root." },
      timeoutMs: { type: "number", description: "Optional timeout in milliseconds. Defaults to 5 minutes." },
    },
    required: ["command"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    const command = String(args.command ?? "").trim();
    if (!command) return { success: false, data: null, error: "Missing command." };
    try {
      return {
        success: true,
        data: await execPersistentRuntimeCommand(
          toolCtx,
          parseVmEnvironment(args.environment),
          command,
          typeof args.cwd === "string" ? args.cwd : undefined,
          typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
        ),
      };
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
