"use node";

import { ConvexError, v } from "convex/values";
import { internalAction } from "../_generated/server";
import { serializableToolContextValidator } from "./proxy_context";
import type {
  RegisteredTool,
  ToolExecutionContext,
  ToolResult,
} from "./registry";

export const executeDocxEditTool = internalAction({
  args: {
    toolName: v.string(),
    toolArgs: v.any(),
    toolContext: serializableToolContextValidator,
  },
  handler: async (ctx, args): Promise<ToolResult> => {
    if (args.toolName !== "propose_docx_edits") {
      throw new ConvexError({
        code: "UNKNOWN_DOCX_EDIT_TOOL" as const,
        message: `Unknown DOCX edit tool: ${args.toolName}`,
      });
    }
    const { proposeDocxEdits } = await import("./propose_docx_edits");
    const tool: RegisteredTool = proposeDocxEdits;
    const toolCtx: ToolExecutionContext = {
      ctx,
      ...args.toolContext,
    };
    return await tool.execute(
      toolCtx,
      args.toolArgs as Record<string, unknown>,
    );
  },
});
