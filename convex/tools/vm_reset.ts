"use node";

import { resetPersistentRuntime } from "../runtime/service_vm";
import { createTool } from "./registry";
import { parseVmEnvironment } from "./vm_shared";

export const vmReset = createTool({
  name: "vm_reset",
  description: "Reset the persistent Vercel runtime workspace while keeping the underlying sandbox session alive.",
  parameters: {
    type: "object",
    properties: {
      environment: { type: "string", description: "Runtime environment: 'python' or 'node'. Defaults to 'python'." },
      confirm: { type: "boolean", description: "Must be true to confirm the reset." },
    },
    required: ["confirm"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    if (args.confirm !== true) {
      return { success: false, data: null, error: "Set confirm=true to reset the persistent runtime workspace." };
    }
    try {
      return {
        success: true,
        data: await resetPersistentRuntime(
          toolCtx,
          parseVmEnvironment(args.environment),
        ),
      };
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
