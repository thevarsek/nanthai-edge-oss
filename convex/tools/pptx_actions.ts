"use node";

import { ConvexError, v } from "convex/values";
import { internalAction } from "../_generated/server";
import { serializableToolContextValidator } from "./proxy_context";
import { editPptx } from "./edit_pptx";
import { generatePptx } from "./generate_pptx";
import type {
  RegisteredTool,
  ToolExecutionContext,
  ToolResult,
} from "./registry";

const pptxToolNames = new Set<string>(["generate_pptx", "edit_pptx"]);
const pptxTools = new Map<string, RegisteredTool>([
  generatePptx,
  editPptx,
].map((tool) => [tool.name, tool]));

export const executePptxTool = internalAction({
  args: {
    toolName: v.string(),
    toolArgs: v.any(),
    toolContext: serializableToolContextValidator,
  },
  handler: async (ctx, args): Promise<ToolResult> => {
    if (!pptxToolNames.has(args.toolName)) {
      throw new ConvexError({
        code: "UNKNOWN_PPTX_TOOL" as const,
        message: `Unknown PPTX tool: ${args.toolName}`,
      });
    }
    const tool = pptxTools.get(args.toolName);
    if (!tool) {
      throw new ConvexError({
        code: "UNKNOWN_PPTX_TOOL" as const,
        message: `Unknown PPTX tool: ${args.toolName}`,
      });
    }

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
