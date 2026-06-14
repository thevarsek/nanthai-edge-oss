"use node";

import { v, ConvexError } from "convex/values";
import { internalAction } from "../../_generated/server";
import { appleCalendarList } from "./calendar_read";
import { discoverAppleCalendars } from "./client";
import {
  appleCalendarCreate,
  appleCalendarUpdate,
  appleCalendarDelete,
} from "./calendar_write";
import type { RegisteredTool, ToolExecutionContext, ToolResult } from "../registry";

const appleCalendarTools = new Map<string, RegisteredTool>([
  appleCalendarList,
  appleCalendarCreate,
  appleCalendarUpdate,
  appleCalendarDelete,
].map((tool) => [tool.name, tool]));

const appleCalendarToolNameValidator = v.union(
  v.literal("apple_calendar_list"),
  v.literal("apple_calendar_create"),
  v.literal("apple_calendar_update"),
  v.literal("apple_calendar_delete"),
);

const toolContextValidator = v.object({
  userId: v.string(),
  chatId: v.optional(v.string()),
  messageId: v.optional(v.string()),
  jobId: v.optional(v.string()),
  generationKey: v.optional(v.string()),
  modelId: v.optional(v.string()),
  requireZdr: v.optional(v.boolean()),
});

export type AppleCalendarToolName =
  | "apple_calendar_list"
  | "apple_calendar_create"
  | "apple_calendar_update"
  | "apple_calendar_delete";

export type AppleCalendarToolContext = {
  userId: string;
  chatId?: string;
  messageId?: string;
  jobId?: string;
  generationKey?: string;
  modelId?: string;
  requireZdr?: boolean;
};

export type ExecuteAppleCalendarToolArgs = {
  toolName: AppleCalendarToolName;
  toolArgs: Record<string, unknown>;
  toolContext: AppleCalendarToolContext;
};

export const executeAppleCalendarTool = internalAction({
  args: {
    toolName: appleCalendarToolNameValidator,
    toolArgs: v.any(),
    toolContext: toolContextValidator,
  },
  handler: async (ctx, args): Promise<ToolResult> => {
    const tool = appleCalendarTools.get(args.toolName);
    if (!tool) {
      throw new ConvexError({
        code: "UNKNOWN_APPLE_CALENDAR_TOOL" as const,
        message: `Unknown Apple Calendar tool: ${args.toolName}`,
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

export const discoverAppleCalendarSummaries = internalAction({
  args: {
    username: v.string(),
    appSpecificPassword: v.string(),
  },
  handler: async (_ctx, args) =>
    await discoverAppleCalendars({
      username: args.username,
      appSpecificPassword: args.appSpecificPassword,
    }),
});
