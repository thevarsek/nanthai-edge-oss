"use node";

import { createTool } from "./registry";
import { resetWorkspace } from "../runtime/service_artifacts";

export const workspaceReset = createTool({
  name: "workspace_reset",
  description:
    "Reset the current chat's code workspace by deleting the sandbox and creating a fresh one.",
  parameters: {
    type: "object",
    properties: {
      confirm: {
        type: "boolean",
        description: "Must be true to confirm the reset.",
      },
    },
    required: ["confirm"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    if (args.confirm !== true) {
      return {
        success: false,
        data: null,
        error: "Workspace reset requires confirm=true.",
      };
    }

    try {
      const result = await resetWorkspace(toolCtx);
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
