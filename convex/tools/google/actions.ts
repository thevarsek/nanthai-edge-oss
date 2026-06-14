"use node";

import { ConvexError, v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { serializableToolContextValidator } from "../proxy_context";
import type { RegisteredTool, ToolExecutionContext, ToolResult } from "../registry";

const googleToolNames = new Set<string>([
  "drive_upload",
  "drive_list",
  "drive_read",
  "drive_move",
  "google_calendar_list",
  "google_calendar_create",
  "google_calendar_delete",
]);

async function googleTools(): Promise<Map<string, RegisteredTool>> {
  const [drive, calendar] = await Promise.all([
    import("./drive"),
    import("./calendar"),
  ]);
  return new Map<string, RegisteredTool>([
    drive.driveUpload,
    drive.driveList,
    drive.driveRead,
    drive.driveMove,
    calendar.calendarList,
    calendar.calendarCreate,
    calendar.calendarDelete,
  ].map((tool) => [tool.name, tool]));
}

export const executeGoogleTool = internalAction({
  args: {
    toolName: v.string(),
    toolArgs: v.any(),
    toolContext: serializableToolContextValidator,
  },
  handler: async (ctx, args): Promise<ToolResult> => {
    if (!googleToolNames.has(args.toolName)) {
      throw new ConvexError({
        code: "UNKNOWN_GOOGLE_TOOL" as const,
        message: `Unknown Google tool: ${args.toolName}`,
      });
    }
    const tools = await googleTools();
    const tool = tools.get(args.toolName);
    if (!tool) {
      throw new ConvexError({
        code: "UNKNOWN_GOOGLE_TOOL" as const,
        message: `Unknown Google tool: ${args.toolName}`,
      });
    }
    const toolCtx: ToolExecutionContext = {
      ctx,
      ...args.toolContext,
    };
    return await tool.execute(toolCtx, args.toolArgs as Record<string, unknown>);
  },
});
