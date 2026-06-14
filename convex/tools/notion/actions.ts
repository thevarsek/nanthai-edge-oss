"use node";

import { ConvexError, v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { serializableToolContextValidator } from "../proxy_context";
import type { RegisteredTool, ToolExecutionContext, ToolResult } from "../registry";

const notionToolNames = new Set<string>([
  "notion_search",
  "notion_read_page",
  "notion_create_page",
  "notion_update_page",
  "notion_delete_page",
  "notion_update_database_entry",
  "notion_query_database",
]);

async function notionTools(): Promise<Map<string, RegisteredTool>> {
  const [pages] = await Promise.all([
    import("./pages"),
  ]);
  return new Map<string, RegisteredTool>([
    pages.notionSearch,
    pages.notionReadPage,
    pages.notionCreatePage,
    pages.notionUpdatePage,
    pages.notionDeletePage,
    pages.notionUpdateDatabaseEntry,
    pages.notionQueryDatabase,
  ].map((tool) => [tool.name, tool]));
}

export const executeNotionTool = internalAction({
  args: {
    toolName: v.string(),
    toolArgs: v.any(),
    toolContext: serializableToolContextValidator,
  },
  handler: async (ctx, args): Promise<ToolResult> => {
    if (!notionToolNames.has(args.toolName)) {
      throw new ConvexError({
        code: "UNKNOWN_NOTION_TOOL" as const,
        message: `Unknown Notion tool: ${args.toolName}`,
      });
    }
    const tools = await notionTools();
    const tool = tools.get(args.toolName);
    if (!tool) {
      throw new ConvexError({
        code: "UNKNOWN_NOTION_TOOL" as const,
        message: `Unknown Notion tool: ${args.toolName}`,
      });
    }
    const toolCtx: ToolExecutionContext = {
      ctx,
      ...args.toolContext,
    };
    return await tool.execute(toolCtx, args.toolArgs as Record<string, unknown>);
  },
});
