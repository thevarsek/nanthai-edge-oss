"use node";

import { ConvexError, v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { serializableToolContextValidator } from "../proxy_context";
import type { RegisteredTool, ToolExecutionContext, ToolResult } from "../registry";

const microsoftToolNames = new Set<string>([
  "outlook_send",
  "outlook_create_draft",
  "outlook_read",
  "outlook_search",
  "outlook_delete",
  "outlook_move",
  "outlook_list_folders",
  "onedrive_upload",
  "onedrive_list",
  "onedrive_read",
  "onedrive_move",
  "ms_calendar_list",
  "ms_calendar_create",
  "ms_calendar_delete",
]);

async function microsoftTools(): Promise<Map<string, RegisteredTool>> {
  const [outlook, outlookDraft, onedrive, calendar] = await Promise.all([
    import("./outlook"),
    import("./outlook_draft"),
    import("./onedrive"),
    import("./calendar"),
  ]);
  return new Map<string, RegisteredTool>([
    outlook.outlookSend,
    outlookDraft.outlookCreateDraft,
    outlook.outlookRead,
    outlook.outlookSearch,
    outlook.outlookDelete,
    outlook.outlookMove,
    outlook.outlookListFolders,
    onedrive.onedriveUpload,
    onedrive.onedriveList,
    onedrive.onedriveRead,
    onedrive.onedriveMove,
    calendar.msCalendarList,
    calendar.msCalendarCreate,
    calendar.msCalendarDelete,
  ].map((tool) => [tool.name, tool]));
}

export const executeMicrosoftTool = internalAction({
  args: {
    toolName: v.string(),
    toolArgs: v.any(),
    toolContext: serializableToolContextValidator,
  },
  handler: async (ctx, args): Promise<ToolResult> => {
    if (!microsoftToolNames.has(args.toolName)) {
      throw new ConvexError({
        code: "UNKNOWN_MICROSOFT_TOOL" as const,
        message: `Unknown Microsoft tool: ${args.toolName}`,
      });
    }
    const tools = await microsoftTools();
    const tool = tools.get(args.toolName);
    if (!tool) {
      throw new ConvexError({
        code: "UNKNOWN_MICROSOFT_TOOL" as const,
        message: `Unknown Microsoft tool: ${args.toolName}`,
      });
    }
    const toolCtx: ToolExecutionContext = {
      ctx,
      ...args.toolContext,
    };
    return await tool.execute(toolCtx, args.toolArgs as Record<string, unknown>);
  },
});
