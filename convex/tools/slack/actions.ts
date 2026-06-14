"use node";

import { ConvexError, v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { serializableToolContextValidator } from "../proxy_context";
import type { RegisteredTool, ToolExecutionContext, ToolResult } from "../registry";

const slackToolNames = new Set<string>([
  "slack_search_messages",
  "slack_search_users",
  "slack_search_channels",
  "slack_send_message",
  "slack_send_message_draft",
  "slack_schedule_message",
  "slack_read_channel",
  "slack_read_thread",
  "slack_create_canvas",
  "slack_update_canvas",
  "slack_read_canvas",
  "slack_read_user_profile",
]);

async function slackTools(): Promise<Map<string, RegisteredTool>> {
  const [tools] = await Promise.all([
    import("./tools"),
  ]);
  return new Map<string, RegisteredTool>([
    tools.slackSearchMessages,
    tools.slackSearchUsers,
    tools.slackSearchChannels,
    tools.slackSendMessage,
    tools.slackSendMessageDraft,
    tools.slackScheduleMessage,
    tools.slackReadChannel,
    tools.slackReadThread,
    tools.slackCreateCanvas,
    tools.slackUpdateCanvas,
    tools.slackReadCanvas,
    tools.slackReadUserProfile,
  ].map((tool) => [tool.name, tool]));
}

export const executeSlackTool = internalAction({
  args: {
    toolName: v.string(),
    toolArgs: v.any(),
    toolContext: serializableToolContextValidator,
  },
  handler: async (ctx, args): Promise<ToolResult> => {
    if (!slackToolNames.has(args.toolName)) {
      throw new ConvexError({
        code: "UNKNOWN_SLACK_TOOL" as const,
        message: `Unknown Slack tool: ${args.toolName}`,
      });
    }
    const tools = await slackTools();
    const tool = tools.get(args.toolName);
    if (!tool) {
      throw new ConvexError({
        code: "UNKNOWN_SLACK_TOOL" as const,
        message: `Unknown Slack tool: ${args.toolName}`,
      });
    }
    const toolCtx: ToolExecutionContext = {
      ctx,
      ...args.toolContext,
    };
    return await tool.execute(toolCtx, args.toolArgs as Record<string, unknown>);
  },
});
