"use node";

import { ConvexError, v } from "convex/values";
import { internalAction } from "../_generated/server";
import { serializableToolContextValidator } from "./proxy_context";
import type { RegisteredTool, ToolExecutionContext, ToolResult } from "./registry";

const presentationToolNames = new Set(["create_presentation", "edit_presentation"]);

async function presentationTools(): Promise<Map<string, RegisteredTool>> {
  const { createPresentationNode, editPresentationNode } = await import("./presentation_tools_node");
  return new Map([
    [createPresentationNode.name, createPresentationNode],
    [editPresentationNode.name, editPresentationNode],
  ]);
}

export const executePresentationTool = internalAction({
  args: {
    toolName: v.string(),
    toolArgs: v.any(),
    toolContext: serializableToolContextValidator,
  },
  handler: async (ctx, args): Promise<ToolResult> => {
    if (!presentationToolNames.has(args.toolName)) {
      throw new ConvexError({
        code: "UNKNOWN_PRESENTATION_TOOL" as const,
        message: `Unknown presentation tool: ${args.toolName}`,
      });
    }
    const tool = (await presentationTools()).get(args.toolName);
    if (!tool) {
      throw new ConvexError({
        code: "UNKNOWN_PRESENTATION_TOOL" as const,
        message: `Unknown presentation tool: ${args.toolName}`,
      });
    }
    const toolCtx: ToolExecutionContext = { ctx, ...args.toolContext };
    return await tool.execute(toolCtx, args.toolArgs as Record<string, unknown>);
  },
});
